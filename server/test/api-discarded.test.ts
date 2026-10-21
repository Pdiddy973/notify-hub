import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminClient, createTestHub, SOURCE_ID, type TestHub } from './support/hub.js';

const ALERTS = '300000000000000001';
const message = { event: 'test', severity: 'info', title: 'Hello' };

describe('discarded log API and protection', () => {
  let hub: TestHub;
  let api: Awaited<ReturnType<typeof adminClient>>;
  beforeEach(async () => {
    hub = createTestHub();
    api = await adminClient(hub);
  });
  afterEach(() => hub.close());

  const badHook = (sourceId = SOURCE_ID, remoteAddress = '10.9.9.9') =>
    hub.app.inject({
      method: 'POST',
      url: `/hook/${sourceId}/wrong-token-value`,
      remoteAddress,
      headers: { 'content-type': 'application/json' },
      payload: message,
    });

  const goodHook = (remoteAddress: string) =>
    hub.app.inject({
      method: 'POST',
      url: `/hook/${SOURCE_ID}/source-token-0123456789`,
      remoteAddress,
      headers: { 'content-type': 'application/json' },
      payload: message,
    });

  const totalRepeats = () => hub.db.listDiscarded().reduce((total, row) => total + row.repeatCount, 0);

  it('lists entries newest first with filters, totals, and whether the source exists', async () => {
    await badHook(SOURCE_ID, '10.0.0.1');
    await badHook('typo-source', '10.0.0.2');
    await badHook('typo-source', '10.0.0.2');

    const page = (await api('GET', '/api/discarded')).json();
    expect(page.total).toBe(2);
    expect(page.entries).toMatchObject([
      { sourceTried: 'typo-source', reason: 'unknown source', repeatCount: 2, sourceExists: false },
      { sourceTried: SOURCE_ID, reason: 'wrong token', sourceExists: true, tokenHint: 'wron...(17)' },
    ]);
    expect(page.blocked).toEqual([]);

    const filtered = (await api('GET', '/api/discarded?reason=wrong%20token')).json();
    expect(filtered.entries.map((e: { sourceTried: string }) => e.sourceTried)).toEqual([SOURCE_ID]);
    expect((await api('GET', '/api/discarded?address=10.0.0.2')).json().total).toBe(1);
    expect((await api('GET', '/api/discarded?source=typo')).json().total).toBe(1);
    // LIKE wildcards in filters are matched literally.
    expect((await api('GET', '/api/discarded?source=%25')).json().total).toBe(0);
    expect((await api('GET', '/api/discarded?limit=1&offset=1')).json().entries).toHaveLength(1);
    expect((await api('GET', '/api/discarded?reason=bad')).statusCode).toBe(400);

    expect((await api('DELETE', '/api/discarded')).json()).toEqual({ removed: 2 });
    expect((await api('GET', '/api/discarded')).json().total).toBe(0);
  });

  it('cuts long sender-chosen text before storing it', async () => {
    await hub.app.inject({
      method: 'POST',
      url: `/hook/${SOURCE_ID}/wrong`,
      headers: { 'user-agent': 'a'.repeat(5000), 'content-type': `application/${'j'.repeat(5000)}` },
      payload: '{}',
    });
    const [row] = hub.db.listDiscarded();
    expect(row!.userAgent).toHaveLength(300);
    expect(row!.contentType).toHaveLength(200);
  });

  it('blocks an address after more than the threshold, answering 429 without logging', async () => {
    await api('PUT', '/api/discarded/settings', { blockThreshold: 3, blockMinutes: 5 });
    for (let i = 0; i < 4; i++) expect((await badHook()).statusCode).toBe(404);
    const blocked = await badHook();
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(290);
    expect(totalRepeats()).toBe(4);

    // A block covers the right token too; other addresses are unaffected.
    expect((await goodHook('10.9.9.9')).statusCode).toBe(429);
    expect((await goodHook('10.1.1.1')).statusCode).toBe(202);
    expect(hub.count('messages')).toBe(1);

    const page = (await api('GET', '/api/discarded')).json();
    expect(page.blocked).toEqual([{ address: '10.9.9.9', until: expect.any(String) }]);
    expect((await api('POST', '/api/discarded/unblock', { address: '10.9.9.9' })).statusCode).toBe(204);
    expect((await goodHook('10.9.9.9')).statusCode).toBe(202);
  });

  it('keeps blocks across a restart until they end or are lifted', async () => {
    await api('PUT', '/api/discarded/settings', { blockThreshold: 1 });
    for (let i = 0; i < 2; i++) await badHook();
    expect((await goodHook('10.9.9.9')).statusCode).toBe(429);
    await hub.restart();
    expect((await goodHook('10.9.9.9')).statusCode).toBe(429);

    api = await adminClient(hub);
    await api('POST', '/api/discarded/unblock', { address: '10.9.9.9' });
    expect(hub.count('address_blocks')).toBe(0);
    await hub.restart();
    expect((await goodHook('10.9.9.9')).statusCode).toBe(202);

    hub.db.saveAddressBlock('10.8.8.8', new Date(Date.now() - 1000).toISOString());
    await hub.restart();
    expect((await goodHook('10.8.8.8')).statusCode).toBe(202);
    expect(hub.count('address_blocks')).toBe(0);
  });

  it('never blocks exempt ranges, and an exemption lifts an existing block', async () => {
    await api('PUT', '/api/discarded/settings', { blockThreshold: 1, exemptRanges: ['192.168.1.0/24'] });
    for (let i = 0; i < 5; i++) expect((await badHook(SOURCE_ID, '192.168.1.20')).statusCode).toBe(404);
    expect(totalRepeats()).toBe(5);

    for (let i = 0; i < 2; i++) await badHook(SOURCE_ID, '10.2.2.2');
    expect((await goodHook('10.2.2.2')).statusCode).toBe(429);
    await api('PUT', '/api/discarded/settings', { exemptRanges: ['192.168.1.0/24', '10.2.2.2'] });
    expect((await goodHook('10.2.2.2')).statusCode).toBe(202);
  });

  it('validates the settings and keeps unchanged values', async () => {
    const defaults = (await api('GET', '/api/discarded/settings')).json();
    expect(defaults).toEqual({
      retentionDays: 7,
      maxRows: 10000,
      blockThreshold: 20,
      blockMinutes: 15,
      exemptRanges: [],
      spikeThreshold: 50,
    });
    const bad = await api('PUT', '/api/discarded/settings', { exemptRanges: ['10.0.0.0/8', '10.0.0.0/40'] });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().issues[0].path).toBe('exemptRanges.1');
    expect((await api('PUT', '/api/discarded/settings', { retentionDays: 0 })).statusCode).toBe(400);
    const saved = await api('PUT', '/api/discarded/settings', { retentionDays: 3 });
    expect(saved.json()).toEqual({ ...defaults, retentionDays: 3 });
  });

  it('keeps the table under the row cap and prunes old rows by retention', async () => {
    await api('PUT', '/api/discarded/settings', { maxRows: 100, blockThreshold: 1000 });
    for (let i = 0; i < 105; i++) await badHook(`missing-${i}`);
    expect(hub.count('discarded')).toBe(100);
    expect(hub.db.listDiscarded({ source: 'missing-0' }).map((row) => row.sourceTried)).not.toContain(
      'missing-0',
    );

    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    hub.sqlite.sqlite
      .prepare("UPDATE discarded SET last_seen = ? WHERE source_tried = 'missing-50'")
      .run(old);
    await api('PUT', '/api/discarded/settings', { retentionDays: 7 });
    expect(hub.count('discarded')).toBe(99);
  });

  it('posts a spike alert to the alert channel once per window', async () => {
    await api('PUT', '/api/settings', { alertChannelId: ALERTS });
    await api('PUT', '/api/discarded/settings', { spikeThreshold: 3, blockThreshold: 1000 });
    for (let i = 0; i < 5; i++) await badHook(`spike-${i}`);
    await vi.waitFor(() => expect(hub.send).toHaveBeenCalledOnce());
    const [channel, embed] = hub.send.mock.calls[0]!;
    expect(channel).toBe(ALERTS);
    expect(embed).toMatchObject({
      title: 'Rejected webhook requests are spiking',
      author: { name: 'Notify Hub' },
    });
    expect(embed.fields?.[0]?.value).toMatch(/^`10\.9\.9\.9` → `spike-\d`$/);

    const log = (await api('GET', '/api/messages')).json().messages;
    expect(log[0]).toMatchObject({ sourceId: 'hub', sourceName: 'Notify Hub', event: 'discard-spike' });
  });

  it('lists the busiest senders in the spike alert, with sender text kept on one line of code', async () => {
    await api('PUT', '/api/settings', { alertChannelId: ALERTS });
    await api('PUT', '/api/discarded/settings', { spikeThreshold: 8, blockThreshold: 1000 });
    // An encoded line break would end the code span and let the link render.
    const injected = 'x%0A%5BLogin%5D(https%3A%2F%2Fevil.example)%60';
    for (let i = 0; i < 5; i++) await badHook(injected, '10.0.0.1');
    for (let i = 0; i < 3; i++) await badHook(`quiet-${i}`, '10.0.0.2');
    await vi.waitFor(() => expect(hub.send).toHaveBeenCalledOnce());
    const fields = hub.send.mock.calls[0]![1].fields!;
    expect(fields[0]).toEqual({
      name: 'unknown source ×5',
      value: "`10.0.0.1` → `x [Login](https://evil.example)'`",
    });
    for (const field of fields) expect(field.value).toMatch(/^`[^`\n]+` → `[^`\n]+`$/);
  });

  it('skips the spike alert when no alert channel is set', async () => {
    await api('PUT', '/api/discarded/settings', { spikeThreshold: 2, blockThreshold: 1000 });
    for (let i = 0; i < 3; i++) await badHook();
    expect(hub.count('messages')).toBe(0);
  });
});

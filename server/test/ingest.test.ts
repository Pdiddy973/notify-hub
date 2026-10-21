import { afterEach, describe, expect, it } from 'vitest';
import { REDACTED } from '../src/security/index.js';
import { createTestHub, postHook, SOURCE_ID, SOURCE_TOKEN, type TestHub } from './support/hub.js';

const message = { event: 'test', severity: 'info', title: 'Hello' };

describe('ingest', () => {
  let hub: TestHub;
  afterEach(() => hub.close());

  it('stores a request with a valid path token and answers 202', async () => {
    hub = createTestHub();
    const response = await postHook(hub, message);
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: 'accepted' });

    const stored = hub.db.getMessage(1)!;
    expect(stored.sourceId).toBe(SOURCE_ID);
    expect(JSON.parse(stored.rawPayload)).toEqual(message);
    expect(stored.rawContentType).toBe('application/json');
  });

  it('accepts the token in the X-Hub-Token header, drops it, and redacts secrets', async () => {
    hub = createTestHub();
    const response = await hub.app.inject({
      method: 'POST',
      url: `/hook/${SOURCE_ID}`,
      headers: { 'content-type': 'application/json', 'x-hub-token': SOURCE_TOKEN, authorization: 'Bearer x' },
      payload: JSON.stringify({ ...message, apiKey: 'secret-key' }),
    });
    expect(response.statusCode).toBe(202);

    const stored = hub.db.getMessage(1)!;
    expect(stored.headers['x-hub-token']).toBeUndefined();
    expect(stored.headers.authorization).toBe(REDACTED);
    expect(JSON.parse(stored.rawPayload).apiKey).toBe(REDACTED);
    expect(JSON.stringify(stored)).not.toContain(SOURCE_TOKEN);
  });

  it('answers a wrong token exactly like an unknown route and stores nothing', async () => {
    hub = createTestHub();
    const rejected = await postHook(hub, message, { token: 'wrong-token-value' });
    const unknown = await hub.app.inject({ method: 'GET', url: '/no/such/route' });

    expect(rejected.statusCode).toBe(404);
    expect(rejected.body).toBe(unknown.body);
    expect(hub.count('messages')).toBe(0);
    expect(hub.count('deliveries')).toBe(0);
  });

  it('logs each rejection reason in the discarded table with only a token hint', async () => {
    hub = createTestHub();
    hub.db.saveSource({
      id: 'off',
      name: 'Off',
      type: 'standard',
      token: 'off-token',
      enabled: false,
      config: {},
    });

    await postHook(hub, message, { token: 'wrong-token-value' });
    await postHook(hub, message, { sourceId: 'nope', token: 'whatever' });
    await postHook(hub, message, { sourceId: 'off', token: 'off-token' });
    await hub.app.inject({ method: 'POST', url: `/hook/${SOURCE_ID}`, payload: '{}' });

    // Newest first, so reversed into the order sent.
    expect(hub.db.listDiscarded().reverse()).toMatchObject([
      { sourceTried: SOURCE_ID, reason: 'wrong token', tokenHint: 'wron...(17)', method: 'POST' },
      { sourceTried: 'nope', reason: 'unknown source' },
      { sourceTried: 'off', reason: 'disabled source' },
      { sourceTried: SOURCE_ID, reason: 'missing token' },
    ]);
    const stored = JSON.stringify(hub.sqlite.sqlite.prepare('SELECT * FROM discarded').all());
    expect(stored).not.toContain('wrong-token-value');
    expect(stored).not.toContain('off-token');
  });

  it('counts repeats from the same sender on one row', async () => {
    hub = createTestHub();
    for (let i = 0; i < 3; i++) await postHook(hub, message, { token: 'wrong-token-value' });
    expect(hub.db.listDiscarded()).toMatchObject([{ reason: 'wrong token', repeatCount: 3 }]);
  });

  it('checks the token before the body: a wrong token with an oversize body is a 404', async () => {
    hub = createTestHub({ bodyLimitBytes: 100 });
    const response = await postHook(hub, { title: 'x'.repeat(500) }, { token: 'wrong-token-value' });
    expect(response.statusCode).toBe(404);
  });

  it('rejects an oversize body from a valid source with 413 and stores nothing', async () => {
    hub = createTestHub({ bodyLimitBytes: 100 });
    const response = await postHook(hub, { title: 'x'.repeat(500) });
    expect(response.statusCode).toBe(413);
    expect(hub.count('messages')).toBe(0);
  });

  it('stores bodies of any content type as text', async () => {
    hub = createTestHub();
    const response = await hub.app.inject({
      method: 'POST',
      url: `/hook/${SOURCE_ID}/${SOURCE_TOKEN}`,
      headers: { 'content-type': 'text/plain' },
      payload: 'plain words',
    });
    expect(response.statusCode).toBe(202);
    expect(hub.db.getMessage(1)?.rawPayload).toBe('plain words');
  });
});

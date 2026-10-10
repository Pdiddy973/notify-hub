import type { MessageSummary } from '@notify-hub/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestHub, login, postHook, type TestHub } from './support/hub.js';

// Reads server-sent events from a live socket until `done` returns true.
async function readStream(url: string, cookie: string, done: (text: string) => boolean): Promise<string> {
  const controller = new AbortController();
  const response = await fetch(url, { headers: { cookie }, signal: controller.signal });
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toMatch(/text\/event-stream/);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    while (!done(text)) {
      const { value, done: ended } = await reader.read();
      if (ended) break;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
  return text;
}

function events(text: string): MessageSummary[] {
  return text
    .split('\n\n')
    .filter((block) => block.startsWith('event: message'))
    .map((block) =>
      JSON.parse(
        block
          .split('\n')
          .find((line) => line.startsWith('data: '))!
          .slice(6),
      ),
    );
}

describe('live log stream', () => {
  let hub: TestHub;
  afterEach(() => hub.close());

  async function listen() {
    const address = await hub.app.listen({ host: '127.0.0.1', port: 0 });
    return `${address}/api/stream`;
  }

  it('sends the log row of each new message as it changes, up to delivered', async () => {
    hub = createTestHub();
    const cookie = await login(hub);
    const url = await listen();

    const reading = readStream(url, cookie, (text) =>
      events(text).some((row) => row.id === 1 && row.status === 'delivered'),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    await postHook(hub, { event: 'download', severity: 'success', title: 'Live one' });

    const rows = events(await reading);
    expect(rows.at(-1)).toMatchObject({
      id: 1,
      title: 'Live one',
      status: 'delivered',
      sourceName: 'Sonarr',
    });
  });

  it('sends keep-alive comments while idle', async () => {
    hub = createTestHub({ keepAliveMs: 20 });
    const cookie = await login(hub);
    const text = await readStream(await listen(), cookie, (t) => t.includes(': keep-alive'));
    expect(text).toContain(': keep-alive');
  });

  it('refuses a stream without a session', async () => {
    hub = createTestHub();
    const response = await fetch(await listen());
    expect(response.status).toBe(401);
  });
});

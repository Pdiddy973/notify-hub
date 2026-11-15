// Log only: stores whatever a service sends, without understanding it.
// Each request becomes one debug message named after the event the payload seems to carry,
// so it can be found in the Live log; the raw payload is kept with it for writing a real
// adapter later.

const EVENT_KEYS = ['eventType', 'event', 'notification_type', 'type', 'status', 'action'];

function guessEvent(text, contentType) {
  if (contentType.includes('multipart')) {
    const match = /"event"\s*:\s*"([^"]{1,60})"/.exec(text);
    return match ? match[1] : 'multipart';
  }
  try {
    const data = JSON.parse(text);
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      for (const key of EVENT_KEYS) {
        const value = data[key];
        if (typeof value === 'string' && value) return value.slice(0, 60);
        if (typeof value === 'number') return String(value);
      }
      return 'json';
    }
  } catch {
    // Not JSON.
  }
  return 'text';
}

export default {
  id: 'log-only',
  name: 'Log only',
  version: 1,
  parse: 'text',
  normalize({ body, headers }) {
    const text = typeof body === 'string' ? body : '';
    const contentType = String(headers['content-type'] ?? '').toLowerCase();
    const raw = guessEvent(text, contentType);
    const event =
      raw
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .toLowerCase()
        .replace(/[^a-z0-9.:-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'unknown';
    return [
      {
        event,
        severity: 'debug',
        title: `Logged: ${raw}`,
        fields: [
          { name: 'Content type', value: contentType || 'none', inline: true },
          { name: 'Size', value: `${text.length} bytes`, inline: true },
          { name: 'User agent', value: String(headers['user-agent'] ?? 'none').slice(0, 100), inline: true },
        ],
      },
    ];
  },
  samples: [
    {
      name: 'json',
      body: '{"eventType":"Test","message":"hello"}',
      headers: { 'content-type': 'application/json' },
    },
    { name: 'text', body: 'plain text', headers: { 'content-type': 'text/plain' } },
  ],
  help:
    'Stores every request as-is, so you can see what a service sends before an adapter exists. ' +
    'Each one shows in the Live log as a debug message; the Raw tab has the payload.',
};

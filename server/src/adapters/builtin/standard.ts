import type { AdapterDefinition } from '../definition.js';

// Accepts JSON already in the standard message format, without source and timestamp; the
// hub checks the shape, so a body without event, severity, and title becomes an adapter error.
export default {
  id: 'standard',
  name: 'Standard message',
  version: 1,
  parse: 'json',
  normalize({ body }) {
    return [body];
  },
  help:
    'Send a JSON POST to the webhook URL with event, severity (info, success, warning, error, or debug), ' +
    'and title; body, fields, url, and imageUrl are optional. Use it from scripts, or from any service ' +
    'that lets you write the JSON body yourself.',
  samples: [
    {
      name: 'basic',
      body: { event: 'test', severity: 'info', title: 'Hello from Notify Hub', body: 'Test message' },
    },
  ],
} satisfies AdapterDefinition;

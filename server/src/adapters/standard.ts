import { adapterMessageSchema } from '@notify-hub/shared';
import type { Adapter } from './index.js';

// Accepts JSON already in the standard message format, without source and timestamp.
export const standardAdapter: Adapter = {
  id: 'standard',
  name: 'Standard message',
  parse: 'json',
  normalize({ body }) {
    return [adapterMessageSchema.parse(body)];
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
};

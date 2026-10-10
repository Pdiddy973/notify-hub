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
  samples: [
    {
      name: 'basic',
      body: { event: 'test', severity: 'info', title: 'Hello from Notify Hub', body: 'Test message' },
    },
  ],
};

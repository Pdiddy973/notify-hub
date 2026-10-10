import { describe, expect, it } from 'vitest';
import { standardMessageSchema } from '@notify-hub/shared';

describe('standardMessageSchema', () => {
  it('accepts a minimal message', () => {
    const message = {
      source: 'sonarr-main',
      event: 'download',
      severity: 'success',
      title: 'Episode downloaded',
      timestamp: '2026-10-09T12:00:00.000Z',
    };
    expect(standardMessageSchema.parse(message)).toEqual(message);
  });

  it('rejects an unknown severity', () => {
    const result = standardMessageSchema.safeParse({
      source: 's',
      event: 'e',
      severity: 'loud',
      title: 't',
      timestamp: '2026-10-09T12:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });
});

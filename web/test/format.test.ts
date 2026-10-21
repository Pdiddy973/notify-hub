import { describe, expect, it } from 'vitest';
import { slugify } from '../src/lib/format';

describe('slugify', () => {
  it('suggests a source id from a name', () => {
    expect(slugify('Sonarr 4K')).toBe('sonarr-4k');
    expect(slugify('  Plex — Living Room!  ')).toBe('plex-living-room');
    expect(slugify('Café')).toBe('cafe');
    expect(slugify('***')).toBe('');
  });

  it('stays within 48 characters without a trailing dash', () => {
    const id = slugify(`${'a'.repeat(47)} b`);
    expect(id).toBe('a'.repeat(47));
  });
});

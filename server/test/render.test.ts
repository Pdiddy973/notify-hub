import type { StandardMessage } from '@notify-hub/shared';
import { describe, expect, it } from 'vitest';
import { embedLength, embedLimits, renderEmbed, severityColors } from '../src/core/index.js';

const base: StandardMessage = {
  source: 'sonarr-main',
  event: 'download',
  severity: 'success',
  title: 'Episode downloaded',
  timestamp: '2026-10-09T16:20:00.000Z',
};
const render = (message: Partial<StandardMessage>) =>
  renderEmbed({ ...base, ...message }, { sourceName: 'Sonarr' });

describe('renderEmbed', () => {
  it('lays out author, title, color, footer, and timestamp', () => {
    expect(render({ body: 'Show S02E05', url: 'https://sonarr.local/series/x' })).toEqual({
      author: { name: 'Sonarr' },
      title: 'Episode downloaded',
      description: 'Show S02E05',
      url: 'https://sonarr.local/series/x',
      color: severityColors.success,
      footer: { text: 'download' },
      timestamp: '2026-10-09T16:20:00.000Z',
    });
  });

  it.each(Object.entries(severityColors))('colors %s messages', (severity, color) => {
    expect(render({ severity: severity as StandardMessage['severity'] }).color).toBe(color);
  });

  it('truncates long text with an ellipsis', () => {
    const embed = render({
      title: 't'.repeat(300),
      body: 'b'.repeat(5000),
      fields: [{ name: 'n'.repeat(300), value: 'v'.repeat(2000) }],
    });
    expect(embed.title).toHaveLength(embedLimits.title);
    expect(embed.title?.endsWith('…')).toBe(true);
    expect(embed.description).toHaveLength(embedLimits.description);
    expect(embed.fields?.[0]?.name).toHaveLength(embedLimits.fieldName);
    expect(embed.fields?.[0]?.value).toHaveLength(embedLimits.fieldValue);
  });

  it('keeps at most 25 fields and fills empty names and values', () => {
    const fields = Array.from({ length: 30 }, (_, i) => ({
      name: `f${i}`,
      value: i === 0 ? '' : 'x',
      inline: true,
    }));
    const embed = render({ fields });
    expect(embed.fields).toHaveLength(embedLimits.fields);
    expect(embed.fields?.[0]).toEqual({ name: 'f0', value: '\u200b', inline: true });
  });

  it('keeps the whole embed within 6000 characters by dropping fields, then shortening the body', () => {
    const fields = Array.from({ length: 10 }, (_, i) => ({ name: `f${i}`, value: 'v'.repeat(1000) }));
    const withFields = render({ body: 'b'.repeat(2000), fields });
    expect(embedLength(withFields)).toBeLessThanOrEqual(embedLimits.total);
    expect(withFields.description).toHaveLength(2000);
    expect(withFields.fields!.length).toBeLessThan(10);

    const longBody = render({
      title: 't'.repeat(256),
      body: 'b'.repeat(4096),
      fields: [
        { name: 'n', value: 'v'.repeat(1024) },
        { name: 'm', value: 'w'.repeat(1024) },
      ],
    });
    expect(embedLength(longBody)).toBeLessThanOrEqual(embedLimits.total);
  });

  it('drops URLs Discord would reject', () => {
    const embed = render({ url: 'not a url', imageUrl: 'ftp://host/poster.jpg' });
    expect(embed.url).toBeUndefined();
    expect(embed.image).toBeUndefined();
    expect(render({ imageUrl: 'https://img.local/p.jpg' }).image).toEqual({ url: 'https://img.local/p.jpg' });
  });
});

import { describe, expect, it } from 'vitest';
import { applyMap, fillTemplate, readPath } from '../src/adapters/map.js';

const scope = {
  body: { series: { title: 'Show' }, items: [{ name: 'first' }], up: false, count: 0, tags: ['a', 'b'] },
  headers: { 'user-agent': 'Sonarr/4' },
  config: { baseUrl: 'http://sonarr.local' },
};

describe('declarative map', () => {
  it('reads dotted paths, array indexes, headers, and config', () => {
    expect(readPath(scope, 'body.series.title')).toBe('Show');
    expect(readPath(scope, 'body.items.0.name')).toBe('first');
    expect(readPath(scope, 'headers.user-agent')).toBe('Sonarr/4');
    expect(readPath(scope, 'config.baseUrl')).toBe('http://sonarr.local');
    expect(readPath(scope, 'body.missing.deeper')).toBeUndefined();
    expect(readPath(scope, 'body.series.constructor')).toBeUndefined();
  });

  it('fills templates; missing values are empty, falsy values are kept, objects become JSON', () => {
    expect(fillTemplate('{{ body.series.title }} on {{config.baseUrl}}', scope)).toBe(
      'Show on http://sonarr.local',
    );
    expect(fillTemplate('[{{body.nope}}] {{body.up}} {{body.count}}', scope)).toBe('[] false 0');
    expect(fillTemplate('{{body.tags}}', scope)).toBe('["a","b"]');
  });

  it('picks values from a field, with a default for the rest', () => {
    const message = applyMap(
      {
        event: 'status',
        severity: { from: 'body.up', values: { true: 'success', false: 'error' }, default: 'info' },
        title: '{{body.series.title}}',
      },
      scope,
    );
    expect(message).toEqual({ event: 'status', severity: 'error', title: 'Show' });
    expect(
      applyMap(
        { event: { from: 'body.nope', values: {}, default: 'other' }, severity: 'info', title: 't' },
        scope,
      ).event,
    ).toBe('other');
    expect(
      applyMap({ event: { from: 'body.count', values: {} }, severity: 'info', title: 't' }, scope).event,
    ).toBe('0');
  });

  it('leaves out optional parts and fields whose placeholders are all empty', () => {
    const message = applyMap(
      {
        event: 'e',
        severity: 'info',
        title: 't',
        body: '{{body.nope}}',
        url: '{{config.baseUrl}}/series',
        fields: [
          { name: 'Series', value: '{{body.series.title}}', inline: true },
          { name: 'Empty', value: '{{body.nope}}' },
          { name: 'Ping', value: '{{body.ping}} ms' },
          { name: 'Partly', value: '{{body.series.title}} / {{body.nope}}' },
        ],
      },
      scope,
    );
    expect(message).toEqual({
      event: 'e',
      severity: 'info',
      title: 't',
      url: 'http://sonarr.local/series',
      fields: [
        { name: 'Series', value: 'Show', inline: true },
        { name: 'Partly', value: 'Show / ' },
      ],
    });
  });
});

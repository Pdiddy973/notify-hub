import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { builtInAdapters, createRegistry, parseBody } from '../src/adapters/index.js';
import { standardAdapter } from '../src/adapters/standard.js';

const fixture = (name: string) => readFileSync(new URL(`fixtures/standard/${name}`, import.meta.url), 'utf8');
const normalize = (body: unknown) => standardAdapter.normalize({ body, headers: {}, config: {} });

describe('standard adapter', () => {
  it('passes a standard message through unchanged', () => {
    const raw = fixture('download.json');
    expect(normalize(parseBody(raw, standardAdapter.parse))).toEqual([JSON.parse(raw)]);
  });

  it('accepts its own samples', () => {
    for (const sample of standardAdapter.samples) expect(normalize(sample.body)).toHaveLength(1);
  });

  it('rejects a body without the required fields', () => {
    expect(() => normalize({ title: 'only a title' })).toThrow();
    expect(() => normalize({ event: 'e', severity: 'loud', title: 't' })).toThrow();
  });

  it('is registered as a built-in adapter', () => {
    expect(createRegistry(builtInAdapters).get('standard')).toBe(standardAdapter);
  });
});

describe('parseBody', () => {
  it('parses json, form, and text bodies', () => {
    expect(parseBody('{"a":1}', 'json')).toEqual({ a: 1 });
    expect(parseBody('a=1&b=two', 'form')).toEqual({ a: '1', b: 'two' });
    expect(parseBody('raw', 'text')).toBe('raw');
  });
});

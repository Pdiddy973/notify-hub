import { describe, expect, it } from 'vitest';
import {
  createRedactor,
  createSecretBox,
  generateToken,
  REDACTED,
  tokenHint,
  tokensMatch,
} from '../src/security/index.js';

describe('secret box', () => {
  const box = createSecretBox('a'.repeat(64));

  it('round-trips a secret and never stores it in plain text', () => {
    const sealed = box.encrypt('bot-token-value');
    expect(sealed).not.toContain('bot-token-value');
    expect(box.decrypt(sealed)).toBe('bot-token-value');
  });

  it('uses a fresh IV for every encryption', () => {
    expect(box.encrypt('same')).not.toBe(box.encrypt('same'));
  });

  it('rejects a tampered value and a different key', () => {
    const sealed = box.encrypt('secret');
    const raw = Buffer.from(sealed.slice(3), 'base64');
    raw[raw.length - 1]! ^= 1;
    expect(() => box.decrypt(`v1:${raw.toString('base64')}`)).toThrow();
    expect(() => createSecretBox('b'.repeat(64)).decrypt(sealed)).toThrow();
  });
});

describe('tokens', () => {
  it('generates 256-bit URL-safe tokens', () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(token);
  });

  it('matches only identical tokens', () => {
    expect(tokensMatch('abc', 'abc')).toBe(true);
    expect(tokensMatch('abc', 'abd')).toBe(false);
    expect(tokensMatch('', 'abc')).toBe(false);
  });

  it('keeps only a hint of a rejected token', () => {
    expect(tokenHint('abcdefgh')).toBe('abcd...(8)');
  });
});

describe('redactor', () => {
  const redact = createRedactor();

  it('masks secret headers in any spelling', () => {
    expect(
      redact.headers({ authorization: 'Bearer x', 'x-api-key': 'k', 'content-type': 'application/json' }),
    ).toEqual({ authorization: REDACTED, 'x-api-key': REDACTED, 'content-type': 'application/json' });
  });

  it('masks nested JSON fields', () => {
    const raw = JSON.stringify({ title: 'hi', apiKey: 'k1', nested: [{ PASSWORD: 'p', keep: 1 }] });
    expect(JSON.parse(redact.body(raw, 'application/json; charset=utf-8'))).toEqual({
      title: 'hi',
      apiKey: REDACTED,
      nested: [{ PASSWORD: REDACTED, keep: 1 }],
    });
  });

  it('masks form fields', () => {
    expect(redact.body('title=hi&token=t1', 'application/x-www-form-urlencoded')).toBe(
      `title=hi&token=${encodeURIComponent(REDACTED)}`,
    );
  });

  it('leaves malformed JSON and plain text unchanged', () => {
    expect(redact.body('{not json', 'application/json')).toBe('{not json');
    expect(redact.body('token=abc', 'text/plain')).toBe('token=abc');
  });
});

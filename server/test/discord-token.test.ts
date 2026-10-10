import { describe, expect, it } from 'vitest';
import { botTokenProblem } from '../src/discord/index.js';

// Shaped like a bot token; not a real one.
const shaped = `${Buffer.from('123456789012345678').toString('base64url')}.GhIjKl.${'a'.repeat(38)}`;

describe('botTokenProblem', () => {
  it('accepts a value shaped like a bot token', () => {
    expect(botTokenProblem(shaped)).toBeNull();
  });

  it('recognises an Application ID', () => {
    expect(botTokenProblem('1234567890123456789')).toMatch(/Application ID/);
  });

  it('recognises the Public Key', () => {
    expect(botTokenProblem('ab'.repeat(32))).toMatch(/Public Key/);
  });

  it('rejects anything else without three dot-separated parts', () => {
    expect(botTokenProblem('client-secret-value-abcdefgh')).toMatch(/three parts/);
    expect(botTokenProblem(`Bot ${shaped}`)).toMatch(/three parts/);
  });
});

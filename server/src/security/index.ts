import { createHash, timingSafeEqual } from 'node:crypto';

// Compares tokens in constant time; hashing first gives both sides the same length.
export function tokensMatch(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

// The first 4 characters and the length: all that is kept of a rejected token.
export function tokenHint(token: string): string {
  return `${token.slice(0, 4)}...(${token.length})`;
}

// Removes secrets from a raw payload before it is stored.
export type Redactor = (raw: string) => string;

// Encrypts and decrypts stored secrets (AES-256-GCM, key from APP_SECRET).
export interface SecretBox {
  encrypt(plain: string): string;
  decrypt(sealed: string): string;
}

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

// Compares tokens in constant time; hashing first gives both sides the same length.
export function tokensMatch(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

// A 256-bit random token, URL-safe.
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

// The first 4 characters and the length: all that is kept of a rejected token.
export function tokenHint(token: string): string {
  return `${token.slice(0, 4)}...(${token.length})`;
}

// Encrypts and decrypts stored secrets (AES-256-GCM, key from APP_SECRET).
export interface SecretBox {
  encrypt(plain: string): string;
  decrypt(sealed: string): string;
}

const SEALED_PREFIX = 'v1:';

export function createSecretBox(appSecret: string): SecretBox {
  const key = Buffer.from(hkdfSync('sha256', appSecret, '', 'notify-hub secrets', 32));
  return {
    encrypt(plain) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return SEALED_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
    },
    decrypt(sealed) {
      if (!sealed.startsWith(SEALED_PREFIX)) throw new Error('Unknown secret format');
      const raw = Buffer.from(sealed.slice(SEALED_PREFIX.length), 'base64');
      const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
      decipher.setAuthTag(raw.subarray(12, 28));
      return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
}

export const REDACTED = '[redacted]';

// Header and field names masked before storage, compared without case, dashes, or underscores.
export const defaultRedactNames = [
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-hub-token',
  'apikey',
  'api_key',
  'token',
  'access_token',
  'password',
  'secret',
];

export interface Redactor {
  headers(headers: Record<string, string>): Record<string, string>;
  // Masks matching fields in JSON and form bodies; other bodies are returned unchanged.
  body(raw: string, contentType: string): string;
}

export function createRedactor(names: string[] = defaultRedactNames): Redactor {
  const normalize = (name: string) => name.toLowerCase().replace(/[-_]/g, '');
  const secretNames = new Set(names.map(normalize));
  const isSecret = (name: string) => secretNames.has(normalize(name));

  const redactValue = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(redactValue);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, inner]) => [key, isSecret(key) ? REDACTED : redactValue(inner)]),
      );
    }
    return value;
  };

  return {
    headers(headers) {
      return Object.fromEntries(
        Object.entries(headers).map(([key, value]) => [key, isSecret(key) ? REDACTED : value]),
      );
    },
    body(raw, contentType) {
      const type = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
      if (type === 'application/json' || type.endsWith('+json')) {
        try {
          return JSON.stringify(redactValue(JSON.parse(raw)));
        } catch {
          return raw;
        }
      }
      if (type === 'application/x-www-form-urlencoded') {
        const params = new URLSearchParams(raw);
        for (const key of new Set(params.keys())) {
          if (isSecret(key)) params.set(key, REDACTED);
        }
        return params.toString();
      }
      return raw;
    },
  };
}

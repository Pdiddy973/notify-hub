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

// Crockford base32: no I, L, O, or U, so the code is easy to read from a log and type.
const SETUP_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// A 60-bit one-time code for first-run setup, as XXXX-XXXX-XXXX.
export function generateSetupCode(): string {
  const chars = [...randomBytes(12)].map((byte) => SETUP_CODE_ALPHABET[byte % 32]).join('');
  return chars.match(/.{4}/g)!.join('-');
}

// Compares setup codes without regard to case, spaces, or dashes, in constant time.
export function setupCodesMatch(given: string, expected: string): boolean {
  const clean = (code: string) => code.toUpperCase().replace(/[^0-9A-Z]/g, '');
  return tokensMatch(clean(given), clean(expected));
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

// A header or field is masked before storage when its name contains one of these words,
// compared without case, dashes, underscores, or dots: refresh_token and x-api-key both match.
export const defaultRedactTerms = [
  'authorization',
  'cookie',
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'privatekey',
  'credential',
];

export interface Redactor {
  headers(headers: Record<string, string>): Record<string, string>;
  // Masks matching fields in JSON and form bodies; other bodies are returned unchanged.
  body(raw: string, contentType: string): string;
}

export function createRedactor(terms: string[] = defaultRedactTerms): Redactor {
  const normalize = (name: string) => name.toLowerCase().replace(/[-_.]/g, '');
  const secretTerms = terms.map(normalize);
  const isSecret = (name: string) => {
    const normalized = normalize(name);
    return secretTerms.some((term) => normalized.includes(term));
  };

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

import { hash, verify } from '@node-rs/argon2';

// Argon2id with the library defaults (19 MiB memory, 2 passes).
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

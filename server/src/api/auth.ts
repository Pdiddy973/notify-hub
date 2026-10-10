import type { FastifyReply, FastifyRequest } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { settingKeys, type Database } from '../db/index.js';

export const SESSION_COOKIE = 'nh_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const hashId = (id: string) => createHash('sha256').update(id).digest('hex');

export interface Auth {
  // The logged-in admin's username, or null.
  currentUser(request: FastifyRequest): string | null;
  startSession(request: FastifyRequest, reply: FastifyReply): void;
  endSession(request: FastifyRequest, reply: FastifyReply): void;
}

export function createAuth(db: Database, now: () => Date = () => new Date()): Auth {
  return {
    currentUser(request) {
      const id = request.cookies[SESSION_COOKIE];
      if (!id) return null;
      const session = db.getSession(hashId(id));
      if (!session || session.expiresAt <= now().toISOString()) return null;
      return db.getSetting(settingKeys.adminUsername) ?? null;
    },

    startSession(request, reply) {
      const id = randomBytes(32).toString('base64url');
      const created = now();
      db.pruneSessions(created.toISOString());
      db.createSession(hashId(id), {
        createdAt: created.toISOString(),
        expiresAt: new Date(created.getTime() + SESSION_TTL_MS).toISOString(),
        userAgent: request.headers['user-agent'],
      });
      reply.setCookie(SESSION_COOKIE, id, {
        path: '/',
        httpOnly: true,
        sameSite: 'strict',
        secure: request.protocol === 'https',
        maxAge: SESSION_TTL_MS / 1000,
      });
    },

    endSession(request, reply) {
      const id = request.cookies[SESSION_COOKIE];
      if (id) db.deleteSession(hashId(id));
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
    },
  };
}

export interface LoginLimiter {
  blocked(address: string): boolean;
  fail(address: string): void;
  reset(address: string): void;
}

// Blocks an address after too many failed logins within the window. Tracks at most
// maxAddresses at a time, dropping the oldest, so a spray from many addresses cannot fill memory.
export function createLoginLimiter({
  max = 5,
  windowMs = 10 * 60 * 1000,
  maxAddresses = 1000,
  now = Date.now,
}: { max?: number; windowMs?: number; maxAddresses?: number; now?: () => number } = {}): LoginLimiter {
  const failures = new Map<string, number[]>();
  const recent = (address: string) => {
    const times = (failures.get(address) ?? []).filter((time) => now() - time < windowMs);
    if (times.length === 0) failures.delete(address);
    else failures.set(address, times);
    return times;
  };
  return {
    blocked: (address) => recent(address).length >= max,
    fail(address) {
      const times = [...recent(address), now()];
      failures.delete(address);
      failures.set(address, times);
      if (failures.size > maxAddresses) {
        for (const known of [...failures.keys()]) recent(known);
        while (failures.size > maxAddresses) failures.delete(failures.keys().next().value!);
      }
    },
    reset: (address) => failures.delete(address),
  };
}

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLoginLimiter } from '../src/api/auth.js';
import { ADMIN, createTestHub, login, SETUP_CODE, type TestHub } from './support/hub.js';

const SETUP = { ...ADMIN, setupCode: SETUP_CODE };

describe('admin login and sessions', () => {
  let hub: TestHub;
  beforeEach(() => {
    hub = createTestHub({ configured: false });
  });
  afterEach(() => hub.close());

  const session = (cookie?: string) =>
    hub.app.inject({ method: 'GET', url: '/api/session', headers: cookie ? { cookie } : {} });

  it('reports a fresh install as needing setup', async () => {
    expect((await session()).json()).toEqual({ hasAdmin: false, setupComplete: false, authenticated: false });
  });

  it('creates the admin account once and logs it in with a strict, HttpOnly cookie', async () => {
    const response = await hub.app.inject({ method: 'POST', url: '/api/setup/account', payload: SETUP });
    expect(response.statusCode).toBe(201);
    const cookie = response.cookies.find((c) => c.name === 'nh_session')!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });

    const info = (await session(`nh_session=${cookie.value}`)).json();
    expect(info).toMatchObject({ hasAdmin: true, authenticated: true, username: 'admin' });

    const again = await hub.app.inject({ method: 'POST', url: '/api/setup/account', payload: SETUP });
    expect(again.statusCode).toBe(409);
  });

  it('requires the setup code from the hub log to create the admin account', async () => {
    const setup = (payload: object) => hub.app.inject({ method: 'POST', url: '/api/setup/account', payload });

    const missing = await setup(ADMIN);
    expect(missing.statusCode).toBe(400);
    expect(missing.json().issues[0].path).toBe('setupCode');

    const wrong = await setup({ ...ADMIN, setupCode: 'AAAA-BBBB-CCCC' });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().issues[0].path).toBe('setupCode');
    expect((await session()).json().hasAdmin).toBe(false);

    const typed = await setup({ ...ADMIN, setupCode: ' abcd efgh jkmn ' });
    expect(typed.statusCode).toBe(201);
  });

  it('blocks setup attempts after five wrong codes', async () => {
    for (let i = 0; i < 5; i++) {
      await hub.app.inject({
        method: 'POST',
        url: '/api/setup/account',
        payload: { ...ADMIN, setupCode: 'WRONG' },
      });
    }
    const blocked = await hub.app.inject({ method: 'POST', url: '/api/setup/account', payload: SETUP });
    expect(blocked.statusCode).toBe(429);
    expect((await session()).json().hasAdmin).toBe(false);
  });

  it('refuses setup posted by a page on another site', async () => {
    const response = await hub.app.inject({
      method: 'POST',
      url: '/api/setup/account',
      headers: { origin: 'http://attacker.example', host: '192.168.1.10:8080' },
      payload: SETUP,
    });
    expect(response.statusCode).toBe(403);
  });

  it('refuses setup through DNS rebinding, where Origin and Host match, without the code', async () => {
    const rebound = { origin: 'http://rebind.attacker.example:8080', host: 'rebind.attacker.example:8080' };
    const response = await hub.app.inject({
      method: 'POST',
      url: '/api/setup/account',
      headers: rebound,
      payload: { ...ADMIN, setupCode: 'GUES-SEDC-ODE0' },
    });
    expect(response.statusCode).toBe(400);
    expect((await session()).json().hasAdmin).toBe(false);
  });

  it('stores an Argon2 hash and a hashed session id, never the secrets themselves', async () => {
    const cookie = await login(hub);
    const settings = JSON.stringify(hub.sqlite.sqlite.prepare('SELECT * FROM settings').all());
    expect(settings).not.toContain(ADMIN.password);
    expect(settings).toContain('$argon2id$');
    const sessions = JSON.stringify(hub.sqlite.sqlite.prepare('SELECT * FROM sessions').all());
    expect(sessions).not.toContain(cookie.split('=')[1]);
  });

  it('returns field errors for a weak password', async () => {
    const response = await hub.app.inject({
      method: 'POST',
      url: '/api/setup/account',
      payload: { ...SETUP, password: 'short' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().issues).toEqual([{ path: 'password', message: 'Use at least 8 characters' }]);
  });

  it('refuses admin routes without a session', async () => {
    for (const url of ['/api/messages', '/api/discord', '/api/channels', '/api/sources', '/api/stream']) {
      const response = await hub.app.inject({ method: 'GET', url });
      expect(response.statusCode, url).toBe(401);
    }
  });

  it('logs in with the right password and rejects a wrong one', async () => {
    await login(hub);
    const wrong = await hub.app.inject({
      method: 'POST',
      url: '/api/login',
      payload: { ...ADMIN, password: 'nope' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toEqual({ error: 'Wrong username or password' });

    const cookie = await login(hub);
    expect((await session(cookie)).json().authenticated).toBe(true);
  });

  it('blocks an address after five failed logins', async () => {
    await login(hub);
    for (let i = 0; i < 5; i++) {
      await hub.app.inject({ method: 'POST', url: '/api/login', payload: { ...ADMIN, password: 'nope' } });
    }
    const blocked = await hub.app.inject({ method: 'POST', url: '/api/login', payload: ADMIN });
    expect(blocked.statusCode).toBe(429);
  });

  it('ends the session on logout', async () => {
    const cookie = await login(hub);
    const logout = await hub.app.inject({ method: 'POST', url: '/api/logout', headers: { cookie } });
    expect(logout.statusCode).toBe(204);
    expect((await session(cookie)).json().authenticated).toBe(false);
    const after = await hub.app.inject({ method: 'GET', url: '/api/messages', headers: { cookie } });
    expect(after.statusCode).toBe(401);
  });

  it('refuses a malformed or null Origin', async () => {
    const cookie = await login(hub);
    for (const origin of ['null', 'not a url']) {
      const response = await hub.app.inject({
        method: 'POST',
        url: '/api/logout',
        headers: { cookie, origin },
      });
      expect(response.statusCode, origin).toBe(403);
    }
  });

  it('refuses changes sent from another site', async () => {
    const cookie = await login(hub);
    const response = await hub.app.inject({
      method: 'POST',
      url: '/api/logout',
      headers: { cookie, origin: 'https://evil.example', host: 'hub.local:8080' },
    });
    expect(response.statusCode).toBe(403);
    expect((await session(cookie)).json().authenticated).toBe(true);
  });
});

describe('login limiter', () => {
  it('blocks after the limit, forgets after the window, and caps how many addresses it tracks', () => {
    let time = 0;
    const limiter = createLoginLimiter({ max: 2, windowMs: 100, maxAddresses: 3, now: () => time });
    limiter.fail('a');
    limiter.fail('a');
    expect(limiter.blocked('a')).toBe(true);
    time = 150;
    expect(limiter.blocked('a')).toBe(false);

    limiter.fail('b');
    limiter.fail('b');
    for (const address of ['c', 'd', 'e']) limiter.fail(address);
    expect(limiter.blocked('b')).toBe(false);
  });
});

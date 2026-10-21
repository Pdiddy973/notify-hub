import { describe, expect, it, vi } from 'vitest';
import {
  createAddressBlocker,
  createAddressMatcher,
  createSpikeWatcher,
  plainAddress,
  rangeProblem,
} from '../src/ingest/index.js';

const MINUTE = 60 * 1000;

function clock(start = Date.UTC(2026, 9, 20, 12)) {
  let time = start;
  return { now: () => time, advance: (ms: number) => (time += ms) };
}

const never = () => false;

describe('address ranges', () => {
  it('accepts addresses and ranges and explains bad ones', () => {
    expect(rangeProblem('192.168.1.0/24')).toBeNull();
    expect(rangeProblem('10.0.0.5')).toBeNull();
    expect(rangeProblem('fd00::/8')).toBeNull();
    expect(rangeProblem('192.168.1.0/33')).toMatch(/0 to 32/);
    expect(rangeProblem('300.1.1.1')).toMatch(/not an IP/);
    expect(rangeProblem('10.0.0.0/8/8')).toMatch(/not an IP/);
  });

  it('matches IPv4, IPv6, and IPv4-mapped addresses', () => {
    const matches = createAddressMatcher(['192.168.1.0/24', '10.0.0.5', 'fd00::/8', 'not valid']);
    expect(matches('192.168.1.77')).toBe(true);
    expect(matches('::ffff:192.168.1.77')).toBe(true);
    expect(matches('10.0.0.5')).toBe(true);
    expect(matches('10.0.0.6')).toBe(false);
    expect(matches('fd12::1')).toBe(true);
    expect(matches('2001:db8::1')).toBe(false);
    expect(plainAddress('::FFFF:10.0.0.5')).toBe('10.0.0.5');
  });
});

describe('address blocker', () => {
  const policy = { threshold: 3, minutes: 15, isExempt: never };

  it('blocks an address after more bad requests than the threshold within 10 minutes', () => {
    const time = clock();
    const blocker = createAddressBlocker({ now: time.now });
    for (let i = 0; i < 3; i++) expect(blocker.recordBad('1.2.3.4', policy)).toBe(false);
    expect(blocker.isBlocked('1.2.3.4', never)).toBe(false);
    expect(blocker.recordBad('1.2.3.4', policy)).toBe(true);
    expect(blocker.isBlocked('1.2.3.4', never)).toBe(true);
    expect(blocker.isBlocked('::ffff:1.2.3.4', never)).toBe(true);
    expect(blocker.remainingMs('1.2.3.4')).toBe(15 * MINUTE);
    expect(blocker.list()).toEqual([
      { address: '1.2.3.4', until: new Date(time.now() + 15 * MINUTE).toISOString() },
    ]);

    time.advance(15 * MINUTE);
    expect(blocker.isBlocked('1.2.3.4', never)).toBe(false);
    expect(blocker.list()).toEqual([]);
  });

  it('forgets bad requests older than the window', () => {
    const time = clock();
    const blocker = createAddressBlocker({ now: time.now });
    for (let i = 0; i < 3; i++) blocker.recordBad('1.2.3.4', policy);
    time.advance(11 * MINUTE);
    expect(blocker.recordBad('1.2.3.4', policy)).toBe(false);
  });

  it('never counts or blocks exempt addresses, and lifts a block when one becomes exempt', () => {
    const blocker = createAddressBlocker();
    const exempt = (address: string) => address === '192.168.1.5';
    for (let i = 0; i < 10; i++) blocker.recordBad('192.168.1.5', { ...policy, isExempt: exempt });
    expect(blocker.isBlocked('192.168.1.5', never)).toBe(false);

    for (let i = 0; i < 4; i++) blocker.recordBad('1.2.3.4', policy);
    expect(blocker.isBlocked('1.2.3.4', (address) => address === '1.2.3.4')).toBe(false);
  });

  it('unblocks on request', () => {
    const blocker = createAddressBlocker();
    for (let i = 0; i < 4; i++) blocker.recordBad('1.2.3.4', policy);
    expect(blocker.unblock('1.2.3.4')).toBe(true);
    expect(blocker.isBlocked('1.2.3.4', never)).toBe(false);
  });

  it('tracks a limited number of addresses', () => {
    const blocker = createAddressBlocker({ maxAddresses: 2 });
    const tight = { ...policy, threshold: 0 };
    for (const address of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) blocker.recordBad(address, tight);
    expect(blocker.list().map((entry) => entry.address)).toEqual(['2.2.2.2', '3.3.3.3']);
  });
});

describe('spike watcher', () => {
  it('alerts once per window when discards reach the threshold', () => {
    const time = clock();
    const onSpike = vi.fn();
    const watcher = createSpikeWatcher({ threshold: () => 3, onSpike, now: time.now });
    for (let i = 0; i < 5; i++) watcher.record();
    expect(onSpike).toHaveBeenCalledOnce();
    expect(onSpike).toHaveBeenCalledWith(3);

    time.advance(10 * MINUTE);
    for (let i = 0; i < 3; i++) watcher.record();
    expect(onSpike).toHaveBeenCalledTimes(2);
  });

  it('stays quiet with a threshold of 0', () => {
    const onSpike = vi.fn();
    const watcher = createSpikeWatcher({ threshold: () => 0, onSpike });
    for (let i = 0; i < 100; i++) watcher.record();
    expect(onSpike).not.toHaveBeenCalled();
  });
});

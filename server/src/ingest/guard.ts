import type { BlockedAddress } from '@notify-hub/shared';
import { BlockList, isIP } from 'node:net';

// Bad requests and discard spikes are counted over this window.
export const GUARD_WINDOW_MS = 10 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

// Strips the IPv4-mapped prefix, so ::ffff:192.168.1.5 is treated as 192.168.1.5.
export function plainAddress(address: string): string {
  return address.toLowerCase().startsWith('::ffff:') && isIP(address.slice(7)) === 4
    ? address.slice(7)
    : address;
}

// Explains why a value is not an address or range, or returns null when it is.
export function rangeProblem(range: string): string | null {
  const [address = '', prefix, extra] = range.split('/');
  const family = isIP(address);
  if (!family || extra !== undefined) return `${range} is not an IP address or range`;
  if (prefix === undefined) return null;
  const bits = Number(prefix);
  const maxBits = family === 4 ? 32 : 128;
  if (!/^\d{1,3}$/.test(prefix) || bits > maxBits) {
    return `${range} needs a prefix length from 0 to ${maxBits}`;
  }
  return null;
}

// Checks addresses against a list of addresses and ranges; invalid entries are skipped.
export function createAddressMatcher(ranges: string[]): (address: string) => boolean {
  const list = new BlockList();
  for (const range of ranges) {
    if (rangeProblem(range)) continue;
    const [address = '', prefix] = range.split('/');
    const family = isIP(address) === 4 ? 'ipv4' : 'ipv6';
    if (prefix === undefined) list.addAddress(address, family);
    else list.addSubnet(address, Number(prefix), family);
  }
  return (address) => {
    const plain = plainAddress(address);
    const family = isIP(plain);
    return family !== 0 && list.check(plain, family === 4 ? 'ipv4' : 'ipv6');
  };
}

// Counts events in one-minute buckets over the guard window.
function createWindowCounter(now: () => number) {
  let buckets: [minute: number, count: number][] = [];
  const current = () => {
    const oldest = Math.floor((now() - GUARD_WINDOW_MS) / MINUTE_MS);
    buckets = buckets.filter(([minute]) => minute > oldest);
    return buckets;
  };
  return {
    add(): number {
      const minute = Math.floor(now() / MINUTE_MS);
      const live = current();
      const last = live[live.length - 1];
      if (last && last[0] === minute) last[1]++;
      else live.push([minute, 1]);
      return live.reduce((total, [, n]) => total + n, 0);
    },
  };
}

export interface BlockPolicy {
  // Bad requests within the window before the address is blocked.
  threshold: number;
  minutes: number;
  isExempt(address: string): boolean;
}

export interface AddressBlocker {
  // True while the address is blocked and not exempt.
  isBlocked(address: string, isExempt: (address: string) => boolean): boolean;
  // Milliseconds until the block ends, or 0.
  remainingMs(address: string): number;
  // Counts a bad request; returns true when it starts a block.
  recordBad(address: string, policy: BlockPolicy): boolean;
  list(): BlockedAddress[];
  unblock(address: string): boolean;
  // Loads blocks saved before a restart; expired ones are skipped.
  restore(blocks: BlockedAddress[]): void;
}

export interface BlockerOptions {
  now?: () => number;
  maxAddresses?: number;
  // Called when a block starts or is lifted early, so it can be saved.
  onBlock?(address: string, until: string): void;
  onUnblock?(address: string): void;
}

// Tracks at most maxAddresses senders, dropping the oldest, so a spray cannot fill memory.
export function createAddressBlocker({
  now = Date.now,
  maxAddresses = 10_000,
  onBlock,
  onUnblock,
}: BlockerOptions = {}): AddressBlocker {
  const counters = new Map<string, ReturnType<typeof createWindowCounter>>();
  const blocks = new Map<string, number>();

  const remainingMs = (address: string) => {
    const until = blocks.get(address);
    if (until === undefined) return 0;
    if (until <= now()) {
      blocks.delete(address);
      return 0;
    }
    return until - now();
  };

  const trim = (map: Map<string, unknown>) => {
    while (map.size > maxAddresses) map.delete(map.keys().next().value!);
  };

  return {
    isBlocked(address, isExempt) {
      const plain = plainAddress(address);
      return remainingMs(plain) > 0 && !isExempt(plain);
    },

    remainingMs: (address) => remainingMs(plainAddress(address)),

    recordBad(address, { threshold, minutes, isExempt }) {
      const plain = plainAddress(address);
      if (isExempt(plain)) return false;
      let counter = counters.get(plain);
      if (!counter) {
        counter = createWindowCounter(now);
        counters.set(plain, counter);
        trim(counters);
      }
      if (counter.add() <= threshold) return false;
      counters.delete(plain);
      const until = now() + minutes * MINUTE_MS;
      blocks.delete(plain);
      blocks.set(plain, until);
      trim(blocks);
      onBlock?.(plain, new Date(until).toISOString());
      return true;
    },

    list() {
      return [...blocks.keys()]
        .filter((address) => remainingMs(address) > 0)
        .map((address) => ({ address, until: new Date(blocks.get(address)!).toISOString() }));
    },

    unblock(address) {
      const plain = plainAddress(address);
      counters.delete(plain);
      const removed = blocks.delete(plain);
      if (removed) onUnblock?.(plain);
      return removed;
    },

    restore(saved) {
      for (const { address, until } of saved) {
        const time = Date.parse(until);
        if (time > now()) blocks.set(plainAddress(address), time);
      }
      trim(blocks);
    },
  };
}

export interface SpikeWatcher {
  // Counts one discard; calls onSpike once per window when the count reaches the threshold.
  record(): void;
}

export function createSpikeWatcher({
  threshold,
  onSpike,
  now = Date.now,
}: {
  // 0 turns the alert off.
  threshold: () => number;
  onSpike(count: number): void;
  now?: () => number;
}): SpikeWatcher {
  const counter = createWindowCounter(now);
  let lastAlert = -Infinity;
  return {
    record() {
      const total = counter.add();
      const limit = threshold();
      if (limit > 0 && total >= limit && now() - lastAlert >= GUARD_WINDOW_MS) {
        lastAlert = now();
        onSpike(total);
      }
    },
  };
}

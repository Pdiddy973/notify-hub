import { describe, expect, it } from 'vitest';
import { conditionsMismatch, createMuteCheck, route, type RoutableMessage } from '../src/core/router.js';
import type { Mute } from '../src/db/index.js';
import { allowedMentionsFor } from '../src/discord/index.js';
import type { Route } from '../src/db/index.js';

const message: RoutableMessage = {
  event: 'Download',
  severity: 'success',
  title: 'Episode downloaded',
  body: 'Show S01E01',
  fields: [{ name: 'Quality', value: 'WEBDL-1080p' }],
};

let nextId = 1;
const rule = (changes: Partial<Route> = {}): Route => {
  const id = nextId++;
  return {
    id,
    name: '',
    sourceId: null,
    priority: id,
    conditions: {},
    action: 'send',
    channelId: `channel-${id}`,
    mentions: [],
    enabled: true,
    continueMatching: false,
    ...changes,
  };
};

describe('route conditions', () => {
  it('matches events without case and any listed severity', () => {
    expect(conditionsMismatch({ events: ['download', 'grab'] }, message)).toBeNull();
    expect(conditionsMismatch({ events: ['grab'] }, message)).toMatch(/event is Download/);
    expect(conditionsMismatch({ severities: ['error', 'success'] }, message)).toBeNull();
    expect(conditionsMismatch({ severities: ['error'] }, message)).toMatch(/severity is success/);
  });

  it('finds text in the title, body, and fields', () => {
    expect(conditionsMismatch({ text: 'EPISODE' }, message)).toBeNull();
    expect(conditionsMismatch({ text: 's01e01' }, message)).toBeNull();
    expect(conditionsMismatch({ text: '1080p' }, message)).toBeNull();
    expect(conditionsMismatch({ text: '4k' }, message)).toMatch(/does not contain/);
  });

  it('needs every set condition to match', () => {
    expect(conditionsMismatch({ events: ['download'], severities: ['error'] }, message)).not.toBeNull();
    expect(conditionsMismatch({}, message)).toBeNull();
  });
});

describe('router', () => {
  it('stops at the first match by priority', () => {
    const second = rule({ priority: 2 });
    const first = rule({ priority: 1 });
    const result = route(message, 'sonarr', [second, first], null);
    expect(result.deliveries).toEqual([{ routeId: first.id, channelId: first.channelId, mentions: [] }]);
    expect(result.outcome).toBe('sent');
    expect(result.checks).toEqual([
      { routeId: first.id, matched: true },
      { routeId: second.id, matched: false, reason: 'not reached; an earlier rule matched' },
    ]);
  });

  it('skips rules that are off, for another source, or whose conditions fail', () => {
    const off = rule({ enabled: false });
    const other = rule({ sourceId: 'radarr' });
    const errors = rule({ conditions: { severities: ['error'] } });
    const mine = rule({ sourceId: 'sonarr' });
    const result = route(message, 'sonarr', [off, other, errors, mine], null);
    expect(result.deliveries).toEqual([{ routeId: mine.id, channelId: mine.channelId, mentions: [] }]);
    expect(result.checks.map((check) => check.reason)).toEqual([
      'rule is turned off',
      'applies to radarr only',
      'severity is success, not error',
      undefined,
    ]);
  });

  it('keeps checking after a rule that continues matching, sending once per channel', () => {
    const everything = rule({ continueMatching: true, channelId: 'all' });
    const duplicate = rule({ continueMatching: true, channelId: 'all' });
    const media = rule({ channelId: 'media' });
    const result = route(message, 'sonarr', [everything, duplicate, media], null);
    expect(result.deliveries).toEqual([
      { routeId: everything.id, channelId: 'all', mentions: [] },
      { routeId: media.id, channelId: 'media', mentions: [] },
    ]);
  });

  it('uses the fallback channel only when nothing matched', () => {
    const errors = rule({ conditions: { severities: ['error'] } });
    expect(route(message, 'sonarr', [errors], 'fallback').deliveries).toEqual([
      { routeId: null, channelId: 'fallback', mentions: [] },
    ]);
    expect(route(message, 'sonarr', [errors], null)).toMatchObject({ deliveries: [], outcome: 'unrouted' });
    expect(route(message, 'sonarr', [rule()], 'fallback').deliveries).toHaveLength(1);
  });
});

describe('mutes in routing', () => {
  const mute = (changes: Partial<Mute>): Mute => ({
    id: 1,
    scope: 'source',
    target: 'sonarr',
    until: null,
    reason: '',
    keepErrors: false,
    createdAt: '',
    ...changes,
  });

  it('skips every rule for a muted source or event', () => {
    const muted = route(message, 'sonarr', [rule()], 'fallback', createMuteCheck([mute({})]));
    expect(muted).toMatchObject({ outcome: 'muted', deliveries: [], mutedBy: 'source sonarr is muted' });
    const event = createMuteCheck([mute({ scope: 'event', target: 'download' })]);
    expect(route(message, 'radarr', [rule()], null, event).outcome).toBe('muted');
    expect(route({ ...message, event: 'grab' }, 'radarr', [rule()], null, event).outcome).toBe('sent');
  });

  it('lets errors through a mute that keeps them', () => {
    const mutes = createMuteCheck([mute({ keepErrors: true })]);
    expect(route(message, 'sonarr', [rule()], null, mutes).outcome).toBe('muted');
    expect(route({ ...message, severity: 'error' }, 'sonarr', [rule()], null, mutes).outcome).toBe('sent');
  });
});

describe('allowed mentions', () => {
  it('lets only the mentions in the content notify', () => {
    expect(allowedMentionsFor(undefined)).toEqual({ parse: [], roles: [], users: [] });
    expect(allowedMentionsFor('<@&400000000000000001> <@!400000000000000002> @here')).toEqual({
      parse: ['everyone'],
      roles: ['400000000000000001'],
      users: ['400000000000000002'],
    });
  });
});

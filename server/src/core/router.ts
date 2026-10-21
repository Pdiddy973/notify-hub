import type {
  RouteCheck,
  RouteConditions,
  RouteOutcome,
  RoutePreview,
  StandardMessage,
} from '@notify-hub/shared';
import type { Mute, Route } from '../db/index.js';

// The parts of a message the conditions look at.
export type RoutableMessage = Pick<StandardMessage, 'event' | 'severity' | 'title' | 'body' | 'fields'>;

// Explains why the conditions do not match, or returns null when they do.
export function conditionsMismatch(conditions: RouteConditions, message: RoutableMessage): string | null {
  const { events, severities, text } = conditions;
  if (events?.length && !events.some((event) => event.toLowerCase() === message.event.toLowerCase())) {
    return `event is ${message.event}, not ${events.join(' or ')}`;
  }
  if (severities?.length && !severities.includes(message.severity)) {
    return `severity is ${message.severity}, not ${severities.join(' or ')}`;
  }
  if (text) {
    const haystack = [
      message.title,
      message.body ?? '',
      ...(message.fields ?? []).flatMap((field) => [field.name, field.value]),
    ]
      .join('\n')
      .toLowerCase();
    if (!haystack.includes(text.toLowerCase())) return `text does not contain "${text}"`;
  }
  return null;
}

// Answers which active mute, if any, silences a message.
export interface MuteCheck {
  // A source or event mute that silences the whole message.
  forMessage(sourceId: string, message: RoutableMessage): Mute | undefined;
  forRoute(routeId: number, message: RoutableMessage): Mute | undefined;
}

// Mutes with keepErrors let messages with severity error through.
export function createMuteCheck(mutes: Mute[]): MuteCheck {
  const applies = (mute: Mute, message: RoutableMessage) =>
    !(mute.keepErrors && message.severity === 'error');
  return {
    forMessage: (sourceId, message) =>
      mutes.find(
        (mute) =>
          applies(mute, message) &&
          ((mute.scope === 'source' && mute.target === sourceId) ||
            (mute.scope === 'event' && mute.target.toLowerCase() === message.event.toLowerCase())),
      ),
    forRoute: (routeId, message) =>
      mutes.find(
        (mute) => applies(mute, message) && mute.scope === 'route' && mute.target === String(routeId),
      ),
  };
}

export const noMutes: MuteCheck = { forMessage: () => undefined, forRoute: () => undefined };

const describeMute = (mute: Mute) =>
  mute.scope === 'source' ? `source ${mute.target} is muted` : `event ${mute.target} is muted`;

// Walks the rules in priority order. A matching send rule adds its channel and stops the
// walk unless it continues matching; a matching drop rule always stops it. With no match
// at all, the fallback channel is used when set.
export function route(
  message: RoutableMessage,
  sourceId: string,
  routes: Route[],
  fallbackChannelId: string | null,
  mutes: MuteCheck = noMutes,
): RoutePreview {
  const ordered = [...routes].sort((a, b) => a.priority - b.priority || a.id - b.id);

  const messageMute = mutes.forMessage(sourceId, message);
  if (messageMute) {
    const reason = `not checked; ${describeMute(messageMute)}`;
    return {
      checks: ordered.map((rule) => ({ routeId: rule.id, matched: false, reason })),
      deliveries: [],
      outcome: 'muted',
      mutedBy: describeMute(messageMute),
    };
  }

  const checks: RouteCheck[] = [];
  const deliveries: RoutePreview['deliveries'] = [];
  let matchedAny = false;
  let mutedMatch = false;
  let dropped = false;
  let stopped = false;

  for (const rule of ordered) {
    if (stopped) {
      checks.push({ routeId: rule.id, matched: false, reason: 'not reached; an earlier rule matched' });
      continue;
    }
    const reason = !rule.enabled
      ? 'rule is turned off'
      : rule.sourceId !== null && rule.sourceId !== sourceId
        ? `applies to ${rule.sourceId} only`
        : rule.action === 'send' && !rule.channelId
          ? 'rule has no channel'
          : conditionsMismatch(rule.conditions, message);
    if (reason) {
      checks.push({ routeId: rule.id, matched: false, reason });
      continue;
    }
    matchedAny = true;

    if (rule.action === 'drop') {
      checks.push({ routeId: rule.id, matched: true, note: 'drops the message' });
      dropped = true;
      stopped = true;
      continue;
    }
    if (mutes.forRoute(rule.id, message)) {
      checks.push({ routeId: rule.id, matched: true, note: 'rule is muted; nothing sent' });
      mutedMatch = true;
    } else {
      checks.push({ routeId: rule.id, matched: true });
      // One delivery per channel; later rules for the same channel add their mentions.
      const existing = deliveries.find((delivery) => delivery.channelId === rule.channelId);
      if (existing) {
        existing.mentions = [...new Set([...existing.mentions, ...rule.mentions])];
      } else {
        deliveries.push({ routeId: rule.id, channelId: rule.channelId!, mentions: [...rule.mentions] });
      }
    }
    if (!rule.continueMatching) stopped = true;
  }

  if (!matchedAny && fallbackChannelId) {
    deliveries.push({ routeId: null, channelId: fallbackChannelId, mentions: [] });
  }
  const outcome: RouteOutcome = deliveries.length
    ? 'sent'
    : dropped
      ? 'dropped'
      : mutedMatch
        ? 'muted'
        : 'unrouted';
  return { checks, deliveries, outcome };
}

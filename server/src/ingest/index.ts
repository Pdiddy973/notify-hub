import type { SettingsStore } from '../core/settings.js';
import type { Database, DiscardReason, Source } from '../db/index.js';
import { tokenHint, tokensMatch, type Redactor } from '../security/index.js';
import { createAddressMatcher, type AddressBlocker } from './guard.js';

export { registerIngestRoutes, sendNotFound } from './routes.js';
export {
  createAddressBlocker,
  createAddressMatcher,
  createSpikeWatcher,
  GUARD_WINDOW_MS,
  plainAddress,
  rangeProblem,
  type AddressBlocker,
  type SpikeWatcher,
} from './guard.js';

// What is known about a webhook request before its body is read.
export interface IngestMeta {
  sourceId: string;
  // From the URL path or the X-Hub-Token header.
  token?: string;
  method: string;
  clientAddress: string;
  userAgent?: string;
  contentType?: string;
  contentLength: number;
}

export interface IngestBody {
  // Header names in lower case.
  headers: Record<string, string>;
  body: string;
  contentType: string;
}

export interface Ingest {
  // Milliseconds until a blocked address may send again, or 0; a blocked request is not logged.
  blockedFor(clientAddress: string): number;
  // Checks the token; a rejected request is recorded in the discarded log and returns null.
  authorize(meta: IngestMeta): Source | null;
  // Stores the redacted request and returns the new message id.
  accept(source: Source, request: IngestBody): number;
}

export interface IngestDeps {
  db: Database;
  redact: Redactor;
  settings: SettingsStore;
  blocker: AddressBlocker;
  // Receives the id of each stored message; the caller decides when processing runs.
  onStored(messageId: number): void;
  // Called after each discarded request.
  onDiscard?(): void;
  now?: () => Date;
}

// Sender-controlled text is cut to these lengths before it is stored.
const MAX_SOURCE_TRIED = 100;
const MAX_USER_AGENT = 300;
const MAX_CONTENT_TYPE = 200;

const clip = (value: string | undefined, max: number) => value?.slice(0, max);

export function createIngest({
  db,
  redact,
  settings,
  blocker,
  onStored,
  onDiscard,
  now = () => new Date(),
}: IngestDeps): Ingest {
  // Rebuilt only when the exempt list changes.
  let exempt: { key: string; matches: (address: string) => boolean } = { key: '', matches: () => false };
  const isExempt = (address: string) => {
    const ranges = settings.discarded().exemptRanges;
    const key = ranges.join(',');
    if (key !== exempt.key) exempt = { key, matches: createAddressMatcher(ranges) };
    return exempt.matches(address);
  };

  return {
    // Settings are read only for addresses that have a block.
    blockedFor(clientAddress) {
      return blocker.isBlocked(clientAddress, isExempt) ? blocker.remainingMs(clientAddress) : 0;
    },

    authorize(meta) {
      const source = db.getSource(meta.sourceId);
      const reason = rejectReason(source, meta.token, now());
      if (!reason && source) return source;

      const policy = settings.discarded();
      db.recordDiscard(
        {
          sourceTried: clip(meta.sourceId, MAX_SOURCE_TRIED)!,
          reason: reason ?? 'unknown source',
          clientAddress: meta.clientAddress,
          userAgent: clip(meta.userAgent, MAX_USER_AGENT),
          method: meta.method,
          contentType: clip(meta.contentType, MAX_CONTENT_TYPE),
          contentLength: meta.contentLength,
          tokenHint: meta.token ? tokenHint(meta.token) : undefined,
        },
        { maxRows: policy.maxRows },
      );
      blocker.recordBad(meta.clientAddress, {
        threshold: policy.blockThreshold,
        minutes: policy.blockMinutes,
        isExempt,
      });
      onDiscard?.();
      return null;
    },

    accept(source, { headers, body, contentType }) {
      const kept = { ...headers };
      delete kept['x-hub-token'];
      const stored = db.insertMessage({
        sourceId: source.id,
        receivedAt: now().toISOString(),
        headers: redact.headers(kept),
        rawPayload: redact.body(body, contentType),
        rawContentType: contentType,
        status: 'received',
      });
      onStored(stored.id);
      return stored.id;
    },
  };
}

// Runs every token comparison even when an earlier check decides, so timing reveals nothing.
function rejectReason(
  source: Source | undefined,
  token: string | undefined,
  now: Date,
): DiscardReason | null {
  const given = token ?? '';
  const current = tokensMatch(given, source?.token ?? '');
  const previous = tokensMatch(given, source?.previousToken ?? '') && Boolean(source?.previousToken);
  if (!source) return 'unknown source';
  if (!source.enabled) return 'disabled source';
  if (!token) return 'missing token';
  if (current) return null;
  if (previous) {
    return source.previousTokenExpiresAt && source.previousTokenExpiresAt > now.toISOString()
      ? null
      : 'expired token';
  }
  return 'wrong token';
}

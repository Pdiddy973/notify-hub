import type { Database, DiscardReason, Source } from '../db/index.js';
import { tokenHint, tokensMatch, type Redactor } from '../security/index.js';

export { registerIngestRoutes, sendNotFound } from './routes.js';

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
  // Checks the token; a rejected request is recorded in the discarded log and returns null.
  authorize(meta: IngestMeta): Source | null;
  // Stores the redacted request and returns the new message id.
  accept(source: Source, request: IngestBody): number;
}

export interface IngestDeps {
  db: Database;
  redact: Redactor;
  // Receives the id of each stored message; the caller decides when processing runs.
  onStored(messageId: number): void;
}

export function createIngest({ db, redact, onStored }: IngestDeps): Ingest {
  return {
    authorize(meta) {
      const source = db.getSource(meta.sourceId);
      const reason = rejectReason(source, meta.token);
      if (reason || !source) {
        db.recordDiscard({
          sourceTried: meta.sourceId,
          reason: reason ?? 'unknown source',
          clientAddress: meta.clientAddress,
          userAgent: meta.userAgent,
          method: meta.method,
          contentType: meta.contentType,
          contentLength: meta.contentLength,
          tokenHint: meta.token ? tokenHint(meta.token) : undefined,
        });
        return null;
      }
      return source;
    },

    accept(source, { headers, body, contentType }) {
      const kept = { ...headers };
      delete kept['x-hub-token'];
      const stored = db.insertMessage({
        sourceId: source.id,
        receivedAt: new Date().toISOString(),
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

// Runs the token comparison even for unknown sources so timing reveals nothing.
function rejectReason(source: Source | undefined, token: string | undefined): DiscardReason | null {
  const matches = tokensMatch(token ?? '', source?.token ?? '');
  if (!source) return 'unknown source';
  if (!source.enabled) return 'disabled source';
  if (!token) return 'missing token';
  return matches ? null : 'wrong token';
}

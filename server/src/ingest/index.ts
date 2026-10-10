import type { Config } from '../config/index.js';
import type { Database, DiscardReason, Source } from '../db/index.js';
import { tokenHint, tokensMatch, type Redactor } from '../security/index.js';

export interface IngestRequest {
  sourceId: string;
  pathToken?: string;
  // Header names in lower case.
  headers: Record<string, string>;
  method: string;
  clientAddress: string;
  contentType: string;
  // Called only after the token check passes.
  readBody(): string;
}

export type IngestResult = { status: 202; messageId: number } | { status: 404 } | { status: 413 };

export interface IngestDeps {
  config: Config;
  db: Database;
  redact: Redactor;
  // Receives the id of each stored message; the caller decides when processing runs.
  onStored(messageId: number): void;
}

export type Ingest = (request: IngestRequest) => IngestResult;

export function createIngest({ config, db, redact, onStored }: IngestDeps): Ingest {
  return (request) => {
    const token = request.pathToken ?? request.headers['x-hub-token'];
    const reason = rejectReason(db.getSource(request.sourceId), token);
    if (reason) {
      db.recordDiscard({
        sourceTried: request.sourceId,
        reason,
        clientAddress: request.clientAddress,
        userAgent: request.headers['user-agent'],
        method: request.method,
        contentType: request.contentType,
        contentLength: Number(request.headers['content-length'] ?? 0),
        tokenHint: token ? tokenHint(token) : undefined,
      });
      return { status: 404 };
    }

    if (Number(request.headers['content-length'] ?? 0) > config.bodyLimitBytes) {
      return { status: 413 };
    }
    const body = request.readBody();
    if (Buffer.byteLength(body) > config.bodyLimitBytes) {
      return { status: 413 };
    }

    const headers = { ...request.headers };
    delete headers['x-hub-token'];
    const stored = db.insertMessage({
      sourceId: request.sourceId,
      receivedAt: new Date().toISOString(),
      headers,
      rawPayload: redact(body),
      rawContentType: request.contentType,
      status: 'received',
    });
    onStored(stored.id);
    return { status: 202, messageId: stored.id };
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

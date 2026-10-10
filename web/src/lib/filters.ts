import type { MessagePage, MessageStatus, MessageSummary, Severity } from '@notify-hub/shared';

export interface LogFilters {
  source?: string;
  status?: MessageStatus;
  severity?: Severity;
  q?: string;
}

export const filterKeys = ['source', 'status', 'severity', 'q'] as const;

export function filtersFromParams(params: URLSearchParams): LogFilters {
  const filters: LogFilters = {};
  for (const key of filterKeys) {
    const value = params.get(key)?.trim();
    if (value) (filters as Record<string, string>)[key] = value;
  }
  return filters;
}

export function messagesQuery(filters: LogFilters, before?: number): string {
  const params = new URLSearchParams();
  for (const key of filterKeys) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  if (before) params.set('before', String(before));
  const query = params.toString();
  return query ? `?${query}` : '';
}

// Client-side check for rows arriving on the live stream. The server's text search
// also looks inside raw payloads, so text matches here are a subset.
export function matchesFilters(row: MessageSummary, filters: LogFilters): boolean {
  if (filters.source && row.sourceId !== filters.source) return false;
  if (filters.status && row.status !== filters.status) return false;
  if (filters.severity && row.severity !== filters.severity) return false;
  if (filters.q) {
    const text = [row.title, row.event, row.sourceName].join(' ').toLowerCase();
    if (!text.includes(filters.q.toLowerCase())) return false;
  }
  return true;
}

export interface LogPages {
  pages: MessagePage[];
  pageParams: unknown[];
}

// Applies one streamed row to the loaded pages: replaces it in place, drops it when it
// no longer matches, or adds it to the top when it is new and matches.
export function mergeRow(
  data: LogPages | undefined,
  row: MessageSummary,
  filters: LogFilters,
): LogPages | undefined {
  if (!data) return data;
  const matches = matchesFilters(row, filters);
  let found = false;
  const pages = data.pages.map((page) => {
    if (!page.messages.some((message) => message.id === row.id)) return page;
    found = true;
    return {
      ...page,
      messages: matches
        ? page.messages.map((message) => (message.id === row.id ? row : message))
        : page.messages.filter((message) => message.id !== row.id),
    };
  });
  if (found || !matches || pages.length === 0) return { ...data, pages };
  const newest = pages[0]!.messages[0]?.id ?? 0;
  if (row.id < newest) return { ...data, pages };
  const [first, ...rest] = pages;
  return { ...data, pages: [{ ...first!, messages: [row, ...first!.messages] }, ...rest] };
}

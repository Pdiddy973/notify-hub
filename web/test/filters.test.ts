import type { MessagePage, MessageSummary } from '@notify-hub/shared';
import { describe, expect, it } from 'vitest';
import {
  filtersFromParams,
  matchesFilters,
  mergeRow,
  messagesQuery,
  type LogPages,
} from '../src/lib/filters.js';

const row = (id: number, extra: Partial<MessageSummary> = {}): MessageSummary => ({
  id,
  sourceId: 'sonarr',
  sourceName: 'Sonarr',
  receivedAt: '2026-10-09T12:00:00.000Z',
  status: 'queued',
  event: 'download',
  severity: 'success',
  title: `Message ${id}`,
  destinations: [],
  hasError: false,
  ...extra,
});

const pages = (...lists: number[][]): LogPages => ({
  pages: lists.map((ids): MessagePage => ({ messages: ids.map((id) => row(id)) })),
  pageParams: lists.map(() => undefined),
});

const ids = (data: LogPages | undefined) => data?.pages.map((page) => page.messages.map((m) => m.id));

describe('log filters', () => {
  it('reads filters from the URL and ignores blanks', () => {
    expect(filtersFromParams(new URLSearchParams('source=sonarr&status=&q=%20disk%20&m=4'))).toEqual({
      source: 'sonarr',
      q: 'disk',
    });
  });

  it('builds the API query with the paging cursor', () => {
    expect(messagesQuery({})).toBe('');
    expect(messagesQuery({ status: 'failed', q: 'a b' }, 40)).toBe('?status=failed&q=a+b&before=40');
  });

  it('matches rows on each filter', () => {
    expect(matchesFilters(row(1), { source: 'sonarr', status: 'queued', severity: 'success' })).toBe(true);
    expect(matchesFilters(row(1), { source: 'radarr' })).toBe(false);
    expect(matchesFilters(row(1), { severity: 'error' })).toBe(false);
    expect(matchesFilters(row(1), { q: 'MESSAGE 1' })).toBe(true);
    expect(matchesFilters(row(1), { q: 'nothing' })).toBe(false);
  });
});

describe('mergeRow', () => {
  it('adds a new matching row to the top of the first page', () => {
    expect(ids(mergeRow(pages([3, 2], [1]), row(4), {}))).toEqual([[4, 3, 2], [1]]);
  });

  it('updates a known row in place', () => {
    const merged = mergeRow(pages([3, 2], [1]), row(1, { status: 'delivered' }), {});
    expect(ids(merged)).toEqual([[3, 2], [1]]);
    expect(merged?.pages[1]?.messages[0]?.status).toBe('delivered');
  });

  it('removes a row that stops matching and ignores new rows that do not match', () => {
    expect(ids(mergeRow(pages([2, 1]), row(2, { status: 'delivered' }), { status: 'queued' }))).toEqual([
      [1],
    ]);
    expect(ids(mergeRow(pages([2, 1]), row(3, { status: 'delivered' }), { status: 'queued' }))).toEqual([
      [2, 1],
    ]);
  });

  it('does not insert an older unknown row above newer ones', () => {
    expect(ids(mergeRow(pages([5, 4]), row(3), {}))).toEqual([[5, 4]]);
  });

  it('leaves an unloaded log alone', () => {
    expect(mergeRow(undefined, row(1), {})).toBeUndefined();
  });
});

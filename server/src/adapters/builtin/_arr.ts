// Shared helpers for the Sonarr, Radarr, and Prowlarr adapters (Servarr webhook format).

type Severity = 'info' | 'success' | 'warning' | 'error' | 'debug';

export interface ArrField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface ArrMessage {
  event: string;
  severity: Severity;
  title: string;
  body?: string;
  fields?: ArrField[];
  url?: string;
  imageUrl?: string;
  key?: string;
}

export type Json = Record<string, unknown>;

export const obj = (value: unknown): Json =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};

export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export const text = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';

// MovieAdded becomes movie-added.
export function kebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
}

export function formatSize(bytes: unknown): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit >= 3 ? 2 : 0)} ${units[unit]}`;
}

// Keeps only fields that have a value.
export function fields(...entries: [string, string][]): ArrField[] {
  return entries.filter(([, value]) => value !== '').map(([name, value]) => ({ name, value, inline: true }));
}

export function poster(media: Json): string | undefined {
  const image = list(media.images)
    .map(obj)
    .find((item) => item.coverType === 'poster');
  const url = text(image?.remoteUrl);
  return /^https:\/\//.test(url) ? url : undefined;
}

// The app's own address from the source setting, or the one the app sends.
export function baseUrl(body: Json, config: Json): string {
  const url = text(config.appUrl) || text(body.applicationUrl);
  return /^https?:\/\//.test(url) ? url.replace(/\/+$/, '') : '';
}

export const optional = (key: 'url' | 'imageUrl' | 'body' | 'key', value: string | undefined) =>
  value ? { [key]: value } : {};

export function releaseFields(release: Json, extra: [string, string][] = []): ArrField[] {
  return fields(
    ['Quality', text(release.quality)],
    ['Size', formatSize(release.size)],
    ['Indexer', text(release.indexer)],
    ['Release group', text(release.releaseGroup)],
    ...extra,
  );
}

export function fileFields(file: Json, release: Json): ArrField[] {
  const media = obj(file.mediaInfo);
  const audio = [text(media.audioCodec), text(media.audioChannels)].filter(Boolean).join(' ');
  const size =
    typeof media.width === 'number' && typeof media.height === 'number'
      ? `${media.width}x${media.height}`
      : '';
  return fields(
    ['Quality', text(file.quality)],
    ['Size', formatSize(file.size)],
    ['Audio', audio],
    ['Resolution', size],
    ['Release group', text(file.releaseGroup)],
    ['Indexer', text(release.indexer)],
  );
}

// Health, health restored, and test, which every Servarr app sends the same way.
export function common(app: string, body: Json): ArrMessage | undefined {
  const type = text(body.eventType);
  if (type === 'Test') {
    return {
      event: 'test',
      severity: 'debug',
      title: `${app} test`,
      body: 'Test message from the webhook connection.',
    };
  }
  if (type === 'Health' || type === 'HealthRestored') {
    const restored = type === 'HealthRestored';
    const check = text(body.type);
    return {
      event: restored ? 'health-restored' : 'health',
      severity: restored ? 'success' : text(body.level) === 'error' ? 'error' : 'warning',
      title: `${app} health${restored ? ' restored' : ''}: ${text(body.message) || check || 'unknown check'}`,
      fields: fields(['Check', check], ['Level', text(body.level)]),
      ...optional('url', /^https:\/\//.test(text(body.wikiUrl)) ? text(body.wikiUrl) : undefined),
      ...optional('key', check ? `health:${check}` : undefined),
    };
  }
  return undefined;
}

// Any event without its own mapping, so nothing is lost.
export function other(app: string, body: Json, subject: string): ArrMessage {
  const type = text(body.eventType) || 'Unknown';
  return {
    event: kebab(type) || 'unknown',
    severity: 'info',
    title: `${app}: ${type}${subject ? ` · ${subject}` : ''}`,
  };
}

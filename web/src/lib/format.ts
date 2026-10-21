const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});
const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const fullFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });

// Time only for today, otherwise date and time.
export function formatTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  return date.toDateString() === now.toDateString() ? timeFormat.format(date) : dateTimeFormat.format(date);
}

export function formatFull(iso: string): string {
  return fullFormat.format(new Date(iso));
}

// Pretty-prints JSON text; other text is returned unchanged.
export function prettyBody(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export function colorHex(color: number | undefined): string {
  return color === undefined ? '#1e1f22' : `#${color.toString(16).padStart(6, '0')}`;
}

// Turns a name into a source id suggestion, such as "Sonarr 4K" into "sonarr-4k".
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
}

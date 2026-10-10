import type { Embed, MessageField, Severity, StandardMessage } from '@notify-hub/shared';

export const severityColors: Record<Severity, number> = {
  info: 0x3498db,
  success: 0x2ecc71,
  warning: 0xf1c40f,
  error: 0xe74c3c,
  debug: 0x95a5a6,
};

// Discord embed limits, in characters.
export const embedLimits = {
  author: 256,
  title: 256,
  description: 4096,
  fields: 25,
  fieldName: 256,
  fieldValue: 1024,
  footer: 2048,
  total: 6000,
};

const ELLIPSIS = '…';
// Discord rejects empty field names and values.
const BLANK = '\u200b';

export function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - ELLIPSIS.length) + ELLIPSIS : text;
}

// Keeps only absolute http(s) URLs, which are the only ones Discord accepts.
function safeUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function renderField(field: MessageField): MessageField {
  return {
    name: truncate(field.name || BLANK, embedLimits.fieldName),
    value: truncate(field.value || BLANK, embedLimits.fieldValue),
    ...(field.inline === undefined ? {} : { inline: field.inline }),
  };
}

export function embedLength(embed: Embed): number {
  return (
    (embed.author?.name.length ?? 0) +
    (embed.title?.length ?? 0) +
    (embed.description?.length ?? 0) +
    (embed.footer?.text.length ?? 0) +
    (embed.fields ?? []).reduce((sum, field) => sum + field.name.length + field.value.length, 0)
  );
}

export interface RenderOptions {
  sourceName: string;
}

// Builds the Discord embed; overflow is truncated with an ellipsis, and the full
// message stays in the log.
export function renderEmbed(message: StandardMessage, { sourceName }: RenderOptions): Embed {
  const url = safeUrl(message.url);
  const imageUrl = safeUrl(message.imageUrl);
  const embed: Embed = {
    author: { name: truncate(sourceName, embedLimits.author) },
    title: truncate(message.title, embedLimits.title),
    ...(message.body ? { description: truncate(message.body, embedLimits.description) } : {}),
    ...(url ? { url } : {}),
    color: severityColors[message.severity],
    ...(message.fields?.length
      ? { fields: message.fields.slice(0, embedLimits.fields).map(renderField) }
      : {}),
    ...(imageUrl ? { image: { url: imageUrl } } : {}),
    footer: { text: truncate(message.event, embedLimits.footer) },
    timestamp: message.timestamp,
  };

  // Over the total: drop fields from the end, then shorten the description.
  while (embedLength(embed) > embedLimits.total && embed.fields?.length) {
    embed.fields = embed.fields.slice(0, -1);
    if (embed.fields.length === 0) delete embed.fields;
  }
  const excess = embedLength(embed) - embedLimits.total;
  if (excess > 0 && embed.description) {
    embed.description = truncate(embed.description, Math.max(embed.description.length - excess, 1));
  }
  return embed;
}

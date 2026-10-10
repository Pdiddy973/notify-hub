import type { Embed } from '@notify-hub/shared';
import { colorHex, formatFull } from '../lib/format';

// Approximates how Discord draws an embed; text is shown as plain text.
export function EmbedPreview({ embed }: { embed: Embed }) {
  const fields = embed.fields ?? [];
  return (
    <div
      className="flex max-w-xl overflow-hidden rounded bg-surface"
      style={{ borderLeft: `4px solid ${colorHex(embed.color)}` }}
    >
      <div className="min-w-0 flex-1 space-y-2 p-3">
        {embed.author && <div className="text-sm font-semibold text-ink">{embed.author.name}</div>}
        {embed.title &&
          (embed.url ? (
            <a
              href={embed.url}
              target="_blank"
              rel="noreferrer"
              className="block font-semibold text-[#00a8fc] hover:underline"
            >
              {embed.title}
            </a>
          ) : (
            <div className="font-semibold text-white">{embed.title}</div>
          ))}
        {embed.description && <div className="text-sm whitespace-pre-wrap text-ink">{embed.description}</div>}
        {fields.length > 0 && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {fields.map((field, index) => (
              <div key={index} className={field.inline ? '' : 'sm:col-span-3'}>
                <div className="text-sm font-semibold text-white">{field.name}</div>
                <div className="text-sm whitespace-pre-wrap text-ink">{field.value}</div>
              </div>
            ))}
          </div>
        )}
        {embed.image && <img src={embed.image.url} alt="" className="max-h-72 rounded" />}
        {(embed.footer || embed.timestamp) && (
          <div className="text-xs text-muted">
            {[embed.footer?.text, embed.timestamp && formatFull(embed.timestamp)].filter(Boolean).join(' • ')}
          </div>
        )}
      </div>
    </div>
  );
}

import { HUB_SOURCE_ID, type AdapterMessage, type StandardMessage } from '@notify-hub/shared';
import type { Database } from '../db/index.js';
import type { Queue } from '../queue/index.js';
import type { Redactor } from '../security/index.js';
import { renderEmbed } from './render.js';
import type { SettingsStore } from './settings.js';

export interface HubAlerts {
  // Logs the alert and queues it for the alert channel; false when no alert channel is set.
  post(alert: AdapterMessage): boolean;
}

export function createHubAlerts({
  db,
  queue,
  settings,
  redact,
}: {
  db: Database;
  queue: Queue;
  settings: SettingsStore;
  redact: Redactor;
}): HubAlerts {
  return {
    post(alert) {
      const { alertChannelId } = settings.hub();
      if (!alertChannelId) return false;
      const receivedAt = new Date().toISOString();
      const message: StandardMessage = { ...alert, source: HUB_SOURCE_ID, timestamp: receivedAt };
      const stored = db.insertMessage({
        sourceId: HUB_SOURCE_ID,
        receivedAt,
        headers: {},
        rawPayload: redact.body(JSON.stringify(alert), 'application/json'),
        rawContentType: 'application/json',
        status: 'normalized',
        normalized: [message],
      });
      queue.enqueue(stored.id, alertChannelId, renderEmbed(message, { sourceName: 'Notify Hub' }));
      db.updateMessage(stored.id, { status: 'queued' });
      return true;
    },
  };
}

// Shows sender-chosen text as one line of inline code: line breaks and other control
// characters would end the code span and let the rest render as markdown or links.
export function asCode(text: string): string {
  const flat = text
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ')
    .replace(/`/g, "'")
    .trim()
    .slice(0, 100);
  return `\`${flat || ' '}\``;
}

// Lists the five senders with the most discards in the window.
export function spikeAlert(db: Database, count: number, since: string): AdapterMessage {
  const top = db
    .listDiscarded({ since, limit: 200 })
    .sort((a, b) => b.repeatCount - a.repeatCount)
    .slice(0, 5);
  return {
    event: 'discard-spike',
    severity: 'warning',
    title: 'Rejected webhook requests are spiking',
    body: `${count} webhook requests were discarded in the last 10 minutes. Check the Discarded page in the hub.`,
    fields: top.map((row) => ({
      name: `${row.reason} ×${row.repeatCount}`,
      value: `${asCode(row.clientAddress)} → ${asCode(row.sourceTried)}`,
    })),
  };
}

import type { AdapterDefinition } from '../definition.js';
import { common, fields, obj, other, text, type ArrMessage, type Json } from './_arr.js';

function normalize(body: Json): ArrMessage[] {
  const shared = common('Prowlarr', body);
  if (shared) return [shared];

  if (text(body.eventType) === 'Grab') {
    const release = obj(body.release);
    return [
      {
        event: 'grab',
        severity: 'info',
        title: `Prowlarr grab: ${text(release.releaseTitle) || 'unknown release'}`,
        fields: fields(
          ['Indexer', text(release.indexer)],
          ['Requested by', text(body.source)],
          ['Trigger', text(body.trigger)],
        ),
      },
    ];
  }
  return [other('Prowlarr', body, '')];
}

export default {
  id: 'prowlarr',
  name: 'Prowlarr',
  version: 1,
  parse: 'json',
  style: {
    icon: 'https://raw.githubusercontent.com/Prowlarr/Prowlarr/develop/Logo/256.png',
  },
  normalize({ body }) {
    return normalize(obj(body));
  },
  help:
    'In Prowlarr, open Settings, Notifications, add a Webhook, and paste the webhook URL from this ' +
    'page. Method POST, no username or password. Tick the triggers you want, then press Test and ' +
    'Save. Grabs repeat what Sonarr and Radarr already report, so a routing rule can drop event ' +
    'grab from this source. Event names: grab, health, health-restored, test, and the lowercase ' +
    'eventType for anything else.',
  samples: [
    {
      name: 'grab',
      body: {
        release: {
          releaseTitle: 'Heart.of.the.Beast.2026.1080p.REPACK.iT.WEB-DL.DDP5.1.Atmos.H.264-GTM',
          indexer: 'Indexer A',
          categories: [],
        },
        trigger: 'api',
        source: 'Radarr',
        host: '172.18.0.1',
        eventType: 'Grab',
        instanceName: 'Prowlarr',
        applicationUrl: '',
      },
    },
    { name: 'test', body: { eventType: 'Test', instanceName: 'Prowlarr', applicationUrl: '' } },
  ],
} satisfies AdapterDefinition;

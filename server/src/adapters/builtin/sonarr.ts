import type { AdapterDefinition } from '../definition.js';
import {
  baseUrl,
  common,
  fields,
  fileFields,
  list,
  obj,
  optional,
  other,
  poster,
  releaseFields,
  text,
  type ArrMessage,
  type Json,
} from './_arr.js';

const pad = (value: unknown) => String(typeof value === 'number' ? value : 0).padStart(2, '0');

// S03E04, or S03E01-E03 for several episodes of one season.
function episodeLabel(episodes: Json[]): string {
  if (episodes.length === 0) return '';
  const first = episodes[0]!;
  const last = episodes[episodes.length - 1]!;
  const start = `S${pad(first.seasonNumber)}E${pad(first.episodeNumber)}`;
  if (episodes.length === 1) return start;
  if (first.seasonNumber === last.seasonNumber) return `${start}-E${pad(last.episodeNumber)}`;
  return `${start}-S${pad(last.seasonNumber)}E${pad(last.episodeNumber)}`;
}

function normalize(body: Json, config: Json): ArrMessage[] {
  const shared = common('Sonarr', body);
  if (shared) return [shared];

  const series = obj(body.series);
  const episodes = list(body.episodes).map(obj);
  const label = episodeLabel(episodes);
  const name = [text(series.title), label].filter(Boolean).join(' ');
  const episodeTitles = episodes.map((episode) => text(episode.title)).filter(Boolean);
  const oneTitle = episodeTitles.length === 1 ? ` · ${episodeTitles[0]}` : '';
  const release = obj(body.release);
  const app = baseUrl(body, config);
  const link = app && text(series.titleSlug) ? `${app}/series/${text(series.titleSlug)}` : undefined;
  const media = { ...optional('url', link), ...optional('imageUrl', poster(series)) };
  const key = optional('key', text(body.downloadId) ? `download:${text(body.downloadId)}` : undefined);

  switch (text(body.eventType)) {
    case 'Grab':
      return [
        {
          event: 'grab',
          severity: 'info',
          title: `Grabbed: ${name}${oneTitle}`,
          ...optional('body', text(release.releaseTitle)),
          fields: releaseFields(release, [
            ['Custom format score', text(release.customFormatScore)],
            ['Client', text(body.downloadClient)],
          ]),
          ...media,
          ...key,
        },
      ];
    case 'Download': {
      // Sonarr sends a second Download webhook per import with episodeFiles and fileCount.
      if (body.episodeFile === undefined) {
        const files = list(body.episodeFiles);
        return [
          {
            event: 'import-complete',
            severity: 'debug',
            title: `Import complete: ${name}`,
            ...optional('body', text(release.releaseTitle)),
            fields: fields(['Files', text(body.fileCount) || String(files.length)]),
            ...media,
            ...key,
          },
        ];
      }
      const upgrade = body.isUpgrade === true;
      return [
        {
          event: upgrade ? 'upgrade' : 'import',
          severity: 'success',
          title: `${upgrade ? 'Upgraded' : 'Imported'}: ${name}${oneTitle}`,
          ...optional('body', text(release.releaseTitle) || text(obj(body.episodeFile).sceneName)),
          fields: fileFields(obj(body.episodeFile), release),
          ...media,
          ...key,
        },
      ];
    }
    case 'Rename': {
      const count = list(body.renamedEpisodeFiles).length;
      return [
        {
          event: 'rename',
          severity: 'debug',
          title: `Renamed: ${text(series.title) || 'series'}`,
          fields: fields(['Files', String(count)]),
          ...media,
        },
      ];
    }
    default:
      return [other('Sonarr', body, name)];
  }
}

const series = {
  id: 682,
  title: 'The Witcher',
  titleSlug: 'the-witcher',
  year: 2019,
  images: [
    {
      coverType: 'poster',
      url: '/MediaCover/682/poster.jpg',
      remoteUrl: 'https://artworks.thetvdb.com/banners/v4/series/362696/posters/6447fd2e14bd2.jpg',
    },
  ],
};
const episode = { id: 43949, episodeNumber: 4, seasonNumber: 3, title: 'The Invitation', seriesId: 682 };

export default {
  id: 'sonarr',
  name: 'Sonarr',
  version: 1,
  parse: 'json',
  config: {
    appUrl: {
      type: 'string',
      label: 'Sonarr URL',
      default: '',
      help: 'Such as http://10.0.30.20:8989; messages link to the series page when set.',
    },
  },
  style: {
    icon: 'https://raw.githubusercontent.com/Sonarr/Sonarr/develop/Logo/256.png',
  },
  normalize({ body, config }) {
    return normalize(obj(body), config);
  },
  help:
    'In Sonarr, open Settings, Connect, add a Webhook, and paste the webhook URL from this page. ' +
    'Method POST, no username or password. Tick the triggers you want (every one is fine: the hub ' +
    'stores each event, and routing rules decide what is posted), then press Test and Save. ' +
    'Event names: grab, import, upgrade, import-complete, rename, health, health-restored, test, ' +
    'and the lowercase eventType for anything else.',
  samples: [
    {
      name: 'grab',
      body: {
        series,
        episodes: [episode],
        release: {
          quality: 'WEBDL-1080p',
          releaseGroup: 'NTb',
          releaseTitle: 'The.Witcher.S03E04.1080p.NF.WEB-DL.DDPA5.1.H.264-NTb',
          indexer: 'Indexer B (Prowlarr)',
          size: 2408703772,
          customFormatScore: 4775,
        },
        downloadClient: 'SABnzbd',
        downloadId: '00000000-0000-4000-8000-000000000001',
        eventType: 'Grab',
        instanceName: 'Sonarr',
        applicationUrl: '',
      },
    },
    {
      name: 'import',
      body: {
        series,
        episodes: [episode],
        episodeFile: {
          quality: 'WEBDL-1080p',
          releaseGroup: 'NTb',
          sceneName: 'The.Witcher.S03E04.1080p.NF.WEB-DL.DDPA5.1.H.264-NTb',
          size: 2251251031,
          mediaInfo: { audioChannels: 5.1, audioCodec: 'EAC3 Atmos', height: 1080, width: 1920 },
        },
        isUpgrade: false,
        downloadId: '00000000-0000-4000-8000-000000000001',
        release: {
          releaseTitle: 'The.Witcher.S03E04.1080p.NF.WEB-DL.DDPA5.1.H.264-NTb',
          indexer: 'Indexer B (Prowlarr)',
          size: 2408703772,
        },
        eventType: 'Download',
        instanceName: 'Sonarr',
        applicationUrl: '',
      },
    },
    {
      name: 'health',
      body: {
        level: 'warning',
        message: 'No download client is available',
        type: 'DownloadClientCheck',
        wikiUrl: 'https://wiki.servarr.com/sonarr/system#no-download-client-is-available',
        eventType: 'Health',
        instanceName: 'Sonarr',
      },
    },
    {
      name: 'test',
      body: {
        series: { id: 1, title: 'Test Title' },
        episodes: [],
        eventType: 'Test',
        instanceName: 'Sonarr',
      },
    },
  ],
} satisfies AdapterDefinition;

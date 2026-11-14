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

function normalize(body: Json, config: Json): ArrMessage[] {
  const shared = common('Radarr', body);
  if (shared) return [shared];

  // Grab sends only remoteMovie; the other events send movie.
  const movie = { ...obj(body.remoteMovie), ...obj(body.movie) };
  const year = typeof movie.year === 'number' && movie.year > 0 ? ` (${movie.year})` : '';
  const name = text(movie.title) ? `${text(movie.title)}${year}` : '';
  const release = obj(body.release);
  const app = baseUrl(body, config);
  const link = app && text(movie.tmdbId) ? `${app}/movie/${text(movie.tmdbId)}` : undefined;
  const media = { ...optional('url', link), ...optional('imageUrl', poster(movie)) };
  const key = optional('key', text(body.downloadId) ? `download:${text(body.downloadId)}` : undefined);

  switch (text(body.eventType)) {
    case 'Grab':
      return [
        {
          event: 'grab',
          severity: 'info',
          title: `Grabbed: ${name}`,
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
      const upgrade = body.isUpgrade === true;
      const file = obj(body.movieFile);
      return [
        {
          event: upgrade ? 'upgrade' : 'import',
          severity: 'success',
          title: `${upgrade ? 'Upgraded' : 'Imported'}: ${name}`,
          ...optional('body', text(release.releaseTitle) || text(file.sceneName)),
          fields: fileFields(file, release),
          ...media,
          ...key,
        },
      ];
    }
    case 'MovieAdded':
      return [
        {
          event: 'movie-added',
          severity: 'info',
          title: `Added: ${name}`,
          ...optional('body', text(movie.overview)),
          fields: fields(
            ['Add method', text(body.addMethod)],
            ['Genres', list(movie.genres).map(text).join(', ')],
          ),
          ...media,
        },
      ];
    case 'Rename':
      return [{ event: 'rename', severity: 'debug', title: `Renamed: ${name || 'movie'}`, ...media }];
    default:
      return [other('Radarr', body, name)];
  }
}

const movie = {
  id: 2526,
  title: 'Heart of the Beast',
  year: 2026,
  tmdbId: 1263337,
  images: [
    {
      coverType: 'poster',
      url: '/MediaCover/2526/poster.jpg',
      remoteUrl: 'https://image.tmdb.org/t/p/original/6sYemVUn79UPKz1ZsSG6kPU4RVy.jpg',
    },
  ],
};

export default {
  id: 'radarr',
  name: 'Radarr',
  version: 1,
  parse: 'json',
  config: {
    appUrl: {
      type: 'string',
      label: 'Radarr URL',
      default: '',
      help: 'Such as http://10.0.30.20:7878; messages link to the movie page when set.',
    },
  },
  style: {
    icon: 'https://raw.githubusercontent.com/Radarr/Radarr/develop/Logo/256.png',
  },
  normalize({ body, config }) {
    return normalize(obj(body), config);
  },
  help:
    'In Radarr, open Settings, Connect, add a Webhook, and paste the webhook URL from this page. ' +
    'Method POST, no username or password. Tick the triggers you want (every one is fine: the hub ' +
    'stores each event, and routing rules decide what is posted), then press Test and Save. ' +
    'Event names: grab, import, upgrade, movie-added, rename, health, health-restored, test, and ' +
    'the lowercase eventType for anything else.',
  samples: [
    {
      name: 'grab',
      body: {
        remoteMovie: { tmdbId: 1263337, title: 'Heart of the Beast', year: 2026 },
        release: {
          quality: 'WEBDL-1080p',
          releaseGroup: 'KyoGo',
          releaseTitle: 'Heart.of.the.Beast.2026.1080p.AMZN.WEB-DL.DDP5.1.Atmos.H.264-KyoGo',
          indexer: 'Indexer A (Prowlarr)',
          size: 6867575000,
          customFormatScore: 3000,
        },
        downloadClient: 'SABnzbd',
        downloadId: '00000000-0000-4000-8000-000000000002',
        eventType: 'Grab',
        instanceName: 'Radarr',
        applicationUrl: '',
      },
    },
    {
      name: 'import',
      body: {
        movie,
        movieFile: {
          quality: 'WEBDL-1080p',
          releaseGroup: 'KyoGo',
          sceneName: 'Heart.of.the.Beast.2026.1080p.AMZN.WEB-DL.DDP5.1.Atmos.H.264-KyoGo',
          size: 6473006535,
          mediaInfo: { audioChannels: 5.1, audioCodec: 'EAC3 Atmos', height: 800, width: 1920 },
        },
        isUpgrade: false,
        downloadId: '00000000-0000-4000-8000-000000000002',
        release: {
          releaseTitle: 'Heart.of.the.Beast.2026.1080p.AMZN.WEB-DL.DDP5.1.Atmos.H.264-KyoGo',
          indexer: 'Indexer A (Prowlarr)',
          size: 6867575000,
        },
        eventType: 'Download',
        instanceName: 'Radarr',
        applicationUrl: '',
      },
    },
    {
      name: 'health',
      body: {
        level: 'warning',
        message: 'No download client is available',
        type: 'DownloadClientCheck',
        wikiUrl: 'https://wiki.servarr.com/radarr/system#no-download-client-is-available',
        eventType: 'Health',
        instanceName: 'Radarr',
      },
    },
    {
      name: 'test',
      body: { movie: { id: 1, title: 'Test Title' }, eventType: 'Test', instanceName: 'Radarr' },
    },
  ],
} satisfies AdapterDefinition;

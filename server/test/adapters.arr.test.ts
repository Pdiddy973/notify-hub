import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adapterMessageSchema } from '@notify-hub/shared';
import { parseBody, type AdapterRegistry } from '../src/adapters/index.js';
import { createAdapterFolder, type AdapterFolder } from './support/adapters.js';

const fixture = (name: string) =>
  parseBody(readFileSync(new URL(`fixtures/${name}.json`, import.meta.url), 'utf8'), 'json');

describe('Sonarr, Radarr, and Prowlarr adapters', () => {
  let folder: AdapterFolder;
  let loader: AdapterRegistry;
  beforeAll(async () => {
    folder = createAdapterFolder();
    loader = await folder.open();
  });
  afterAll(() => folder.close());

  const run = async (id: string, name: string, config: Record<string, unknown> = {}) => {
    const messages = await loader.normalize(id, { body: fixture(name), headers: {}, config });
    for (const message of messages) adapterMessageSchema.parse(message);
    return messages as Record<string, unknown>[];
  };

  it('loads all three with passing samples', () => {
    const { adapters } = loader.list();
    for (const id of ['sonarr', 'radarr', 'prowlarr']) {
      expect(adapters.find((adapter) => adapter.id === id)).toMatchObject({
        status: 'ok',
        origin: 'built-in',
      });
    }
  });

  describe('Sonarr', () => {
    it('maps a grab', async () => {
      const [message] = await run('sonarr', 'sonarr/grab');
      expect(message).toMatchObject({
        event: 'grab',
        severity: 'info',
        title: 'Grabbed: The Witcher S03E01 · Shaerrawedd',
        body: 'The.Witcher.S03E01.1080p.NF.WEB-DL.DDPA5.1.HDR.HEVC-NTb-xpost',
        imageUrl: 'https://artworks.thetvdb.com/banners/v4/series/362696/posters/6447fd2e14bd2.jpg',
        key: 'download:00000000-0000-4000-8000-000000000001',
      });
      expect(message!.fields).toEqual(
        expect.arrayContaining([
          { name: 'Quality', value: 'WEBDL-1080p', inline: true },
          { name: 'Size', value: '2.42 GB', inline: true },
          { name: 'Indexer', value: 'Indexer C (Prowlarr)', inline: true },
          { name: 'Client', value: 'SABnzbd', inline: true },
        ]),
      );
      expect(message!.url).toBeUndefined();
    });

    it('maps an import, with a series link when the app URL is set', async () => {
      const [message] = await run('sonarr', 'sonarr/import', { appUrl: 'http://10.0.30.20:8989/' });
      expect(message).toMatchObject({
        event: 'import',
        severity: 'success',
        title: 'Imported: The Witcher S03E04 · The Invitation',
        url: 'http://10.0.30.20:8989/series/the-witcher',
      });
      expect(message!.fields).toEqual(
        expect.arrayContaining([
          { name: 'Audio', value: 'EAC3 Atmos 5.1', inline: true },
          { name: 'Resolution', value: '1920x1080', inline: true },
        ]),
      );
    });

    it('marks an import as an upgrade when Sonarr says so', async () => {
      const body = { ...(fixture('sonarr/import') as object), isUpgrade: true };
      const [message] = await loader.normalize('sonarr', { body, headers: {}, config: {} });
      expect(message).toMatchObject({
        event: 'upgrade',
        title: 'Upgraded: The Witcher S03E04 · The Invitation',
      });
    });

    it('keeps the second import webhook as import-complete', async () => {
      const [message] = await run('sonarr', 'sonarr/import-complete');
      expect(message).toMatchObject({ event: 'import-complete', severity: 'debug' });
    });

    it('maps a rename', async () => {
      const [message] = await run('sonarr', 'sonarr/rename');
      expect(message).toMatchObject({ event: 'rename', severity: 'debug', title: 'Renamed: FLCL' });
    });

    it('maps health, health restored, and test', async () => {
      expect((await run('sonarr', 'sonarr/health'))[0]).toMatchObject({
        event: 'health',
        severity: 'warning',
        title: 'Sonarr health: No download client is available',
        url: 'https://wiki.servarr.com/sonarr/system#no-download-client-is-available',
        key: 'health:DownloadClientCheck',
      });
      expect((await run('sonarr', 'sonarr/health-restored'))[0]).toMatchObject({
        event: 'health-restored',
        severity: 'success',
        key: 'health:DownloadClientCheck',
      });
      expect((await run('sonarr', 'sonarr/test'))[0]).toMatchObject({ event: 'test', severity: 'debug' });
    });

    it('raises a health error to severity error', async () => {
      const body = { ...(fixture('sonarr/health') as object), level: 'error' };
      const [message] = await loader.normalize('sonarr', { body, headers: {}, config: {} });
      expect(message).toMatchObject({ severity: 'error' });
    });

    it('keeps unknown events as info with their name', async () => {
      const body = { ...(fixture('sonarr/grab') as object), eventType: 'SeriesDelete' };
      const [message] = await loader.normalize('sonarr', { body, headers: {}, config: {} });
      expect(message).toMatchObject({
        event: 'series-delete',
        severity: 'info',
        title: 'Sonarr: SeriesDelete · The Witcher S03E01',
      });
    });
  });

  describe('Radarr', () => {
    it('maps a grab from remoteMovie', async () => {
      const [message] = await run('radarr', 'radarr/grab');
      expect(message).toMatchObject({
        event: 'grab',
        severity: 'info',
        title: 'Grabbed: Heart of the Beast (2026)',
        key: 'download:00000000-0000-4000-8000-000000000003',
      });
    });

    it('maps an import with the poster and a movie link', async () => {
      const [message] = await run('radarr', 'radarr/import', { appUrl: 'http://10.0.30.20:7878' });
      expect(message).toMatchObject({
        event: 'import',
        severity: 'success',
        title: 'Imported: Heart of the Beast (2026)',
        url: 'http://10.0.30.20:7878/movie/1263337',
        imageUrl: 'https://image.tmdb.org/t/p/original/6sYemVUn79UPKz1ZsSG6kPU4RVy.jpg',
      });
    });

    it('maps movie added, health, health restored, and test', async () => {
      expect((await run('radarr', 'radarr/movie-added'))[0]).toMatchObject({
        event: 'movie-added',
        title: 'Added: Heart of the Beast (2026)',
      });
      expect((await run('radarr', 'radarr/health'))[0]).toMatchObject({
        event: 'health',
        severity: 'warning',
      });
      expect((await run('radarr', 'radarr/health-restored'))[0]).toMatchObject({ event: 'health-restored' });
      expect((await run('radarr', 'radarr/test'))[0]).toMatchObject({ event: 'test', severity: 'debug' });
    });
  });

  describe('Prowlarr', () => {
    it('maps a grab and a test', async () => {
      expect((await run('prowlarr', 'prowlarr/grab'))[0]).toMatchObject({
        event: 'grab',
        severity: 'info',
        title: 'Prowlarr grab: Heart.of.the.Beast.2026.1080p.REPACK.iT.WEB-DL.DDP5.1.Atmos.H.264-GTM',
        fields: [
          { name: 'Indexer', value: 'Indexer A', inline: true },
          { name: 'Requested by', value: 'Radarr', inline: true },
          { name: 'Trigger', value: 'api', inline: true },
        ],
      });
      expect((await run('prowlarr', 'prowlarr/test'))[0]).toMatchObject({ event: 'test' });
    });
  });

  it('ignores a non-https wiki link and a non-http app URL', async () => {
    const body = { ...(fixture('sonarr/health') as object), wikiUrl: 'javascript:alert(1)' };
    const [health] = await loader.normalize('sonarr', { body, headers: {}, config: {} });
    expect((health as Record<string, unknown>).url).toBeUndefined();
    const [imported] = await run('sonarr', 'sonarr/import', { appUrl: 'javascript:alert(1)' });
    expect(imported!.url).toBeUndefined();
  });
});

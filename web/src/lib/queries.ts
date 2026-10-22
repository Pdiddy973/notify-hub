import type {
  AdapterList,
  ChannelInfo,
  DashboardInfo,
  DiscardedPage,
  DiscardedQuery,
  DiscardedSettings,
  DiscordStatus,
  MuteInfo,
  RouteInfo,
  SessionInfo,
  SettingsInfo,
  SourceDetail,
  SourceSummary,
} from '@notify-hub/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export const keys = {
  session: ['session'] as const,
  discord: ['discord'] as const,
  channels: ['channels'] as const,
  adapters: ['adapters'] as const,
  sources: ['sources'] as const,
  source: (id: string) => ['source', id] as const,
  routes: ['routes'] as const,
  messages: ['messages'] as const,
  message: (id: number) => ['message', id] as const,
  discarded: ['discarded'] as const,
  discardedSettings: ['discarded-settings'] as const,
  settings: ['settings'] as const,
  dashboard: ['dashboard'] as const,
  mutes: ['mutes'] as const,
};

export function useSession() {
  return useQuery({ queryKey: keys.session, queryFn: () => api<SessionInfo>('/session') });
}

export function useDiscordStatus({
  refetchInterval = 15_000,
  enabled = true,
}: { refetchInterval?: number | false; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: keys.discord,
    queryFn: () => api<DiscordStatus>('/discord'),
    refetchInterval,
    enabled,
  });
}

// With pollUntilFound, checks again every 2 seconds until the bot has synced channels.
export function useChannels({ pollUntilFound = false }: { pollUntilFound?: boolean } = {}) {
  return useQuery({
    queryKey: keys.channels,
    queryFn: () => api<ChannelInfo[]>('/channels'),
    refetchInterval: (query) => (pollUntilFound && !query.state.data?.length ? 2000 : false),
  });
}

// With live, checks every 3 seconds so edits to adapter files show up without a reload.
export function useAdapters({ live = false }: { live?: boolean } = {}) {
  return useQuery({
    queryKey: keys.adapters,
    queryFn: () => api<AdapterList>('/adapters'),
    refetchInterval: live ? 3000 : false,
  });
}

export function useSources() {
  return useQuery({ queryKey: keys.sources, queryFn: () => api<SourceSummary[]>('/sources') });
}

export function useSource(id: string | undefined) {
  return useQuery({
    queryKey: keys.source(id ?? ''),
    queryFn: () => api<SourceDetail>(`/sources/${encodeURIComponent(id!)}`),
    enabled: id !== undefined,
  });
}

export function useRoutes() {
  return useQuery({ queryKey: keys.routes, queryFn: () => api<RouteInfo[]>('/routes') });
}

export function useDiscarded(query: DiscardedQuery) {
  const params = new URLSearchParams(
    Object.entries(query).flatMap(([key, value]) =>
      value === undefined || value === '' ? [] : [[key, String(value)]],
    ),
  );
  return useQuery({
    queryKey: [...keys.discarded, query],
    queryFn: () => api<DiscardedPage>(`/discarded?${params}`),
    refetchInterval: 15_000,
  });
}

export function useDiscardedSettings() {
  return useQuery({
    queryKey: keys.discardedSettings,
    queryFn: () => api<DiscardedSettings>('/discarded/settings'),
  });
}

// Active mutes; refreshed each minute so ended mutes disappear.
export function useMutes() {
  return useQuery({
    queryKey: keys.mutes,
    queryFn: () => api<MuteInfo[]>('/mutes'),
    refetchInterval: 60_000,
  });
}

export function useSettings() {
  return useQuery({ queryKey: keys.settings, queryFn: () => api<SettingsInfo>('/settings') });
}

// Counts since local midnight.
export function useDashboard() {
  return useQuery({
    queryKey: keys.dashboard,
    queryFn: () => {
      const midnight = new Date();
      midnight.setHours(0, 0, 0, 0);
      return api<DashboardInfo>(`/dashboard?since=${encodeURIComponent(midnight.toISOString())}`);
    },
    refetchInterval: 15_000,
  });
}

// Start of webhook URLs: the address set in Settings, or this browser's address.
// ready is false until the setting has loaded, so a URL is never built from the wrong start.
export function useHookBase(): { base: string; fromSettings: boolean; ready: boolean } {
  const settings = useSettings();
  const saved = settings.data?.webhookBaseUrl;
  const ready = settings.isSuccess;
  return saved
    ? { base: saved, fromSettings: true, ready }
    : { base: window.location.origin, fromSettings: false, ready };
}

// Channel id to name, for showing rule targets and settings.
export function useChannelNames(): Map<string, string> {
  const channels = useChannels();
  return new Map((channels.data ?? []).map((channel) => [channel.id, channel.name]));
}

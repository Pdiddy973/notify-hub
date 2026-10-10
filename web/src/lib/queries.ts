import type { ChannelInfo, DiscordStatus, SessionInfo, SourceSummary } from '@notify-hub/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export const keys = {
  session: ['session'] as const,
  discord: ['discord'] as const,
  channels: ['channels'] as const,
  sources: ['sources'] as const,
  messages: ['messages'] as const,
  message: (id: number) => ['message', id] as const,
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

export function useSources() {
  return useQuery({ queryKey: keys.sources, queryFn: () => api<SourceSummary[]>('/sources') });
}

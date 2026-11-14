import type { SessionInfo } from '@notify-hub/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Navigate, NavLink, Outlet } from 'react-router';
import { api } from '../lib/api';
import { keys, useDashboard, useDiscordStatus, useSession } from '../lib/queries';
import { Button, Spinner } from './ui';

// Sends visitors to setup or login until both are done.
export function RequireSession() {
  const session = useSession();
  if (session.isPending) return <PageSpinner />;
  if (session.isError) return <Navigate to="/login" replace />;
  const { hasAdmin, authenticated, setupComplete } = session.data;
  if (!hasAdmin || (authenticated && !setupComplete)) return <Navigate to="/setup" replace />;
  if (!authenticated) return <Navigate to="/login" replace />;
  return <Layout />;
}

export function PageSpinner() {
  return (
    <div className="grid min-h-screen place-items-center">
      <Spinner />
    </div>
  );
}

function DiscordBadge() {
  const { data } = useDiscordStatus();
  if (!data) return null;
  const label = !data.configured
    ? 'Discord not set up'
    : data.connected
      ? 'Discord connected'
      : 'Discord offline';
  const color = !data.configured ? 'bg-warn' : data.connected ? 'bg-ok' : 'bg-bad';
  return (
    <span className="flex items-center gap-2 text-xs text-muted" title={data.guildName ?? undefined}>
      <span className={`size-2 rounded-full ${color}`} />
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}

const pages = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/log', label: 'Live log' },
  { to: '/sources', label: 'Sources' },
  { to: '/routing', label: 'Routing' },
  { to: '/muted', label: 'Muted' },
  { to: '/discarded', label: 'Discarded' },
  { to: '/adapters', label: 'Adapters' },
  { to: '/settings', label: 'Settings' },
];

// Discarded requests since local midnight, shown next to the Discarded link.
function DiscardedCount() {
  const { data } = useDashboard();
  if (!data?.discarded) return null;
  return (
    <span className="ml-1.5 rounded-full bg-warn/20 px-1.5 text-xs text-warn tabular-nums">
      {data.discarded > 999 ? '999+' : data.discarded}
    </span>
  );
}

function Layout() {
  const session = useSession();
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: () => api('/logout', { method: 'POST' }),
    onSuccess: () => {
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== keys.session[0] });
      queryClient.setQueryData<SessionInfo>(
        keys.session,
        (info) => info && { ...info, authenticated: false },
      );
    },
  });

  const navClass = ({ isActive }: { isActive: boolean }) =>
    `rounded px-3 py-1.5 text-sm ${isActive ? 'bg-raised text-white' : 'text-muted hover:text-ink'}`;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-surface">
        <div className="flex w-full items-center gap-4 px-4 py-2 sm:px-6">
          <span className="shrink-0 font-semibold text-white">Notify Hub</span>
          <nav className="-mx-1 flex min-w-0 gap-1 overflow-x-auto px-1">
            {pages.map((page) => (
              <NavLink key={page.to} to={page.to} className={navClass}>
                <span className="whitespace-nowrap">
                  {page.label}
                  {page.to === '/discarded' && <DiscardedCount />}
                </span>
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-3">
            <DiscordBadge />
            <span className="hidden text-sm text-muted md:inline">{session.data?.username}</span>
            <Button variant="ghost" onClick={() => logout.mutate()} disabled={logout.isPending}>
              Log out
            </Button>
          </div>
        </div>
      </header>
      <main className="flex w-full min-w-0 flex-1 flex-col px-4 py-4 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}

export function useRefreshSession() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: keys.session });
}

import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Badge, Card, ErrorBox, PageHeader, Spinner } from '../components/ui';
import { errorMessage } from '../lib/api';
import { formatTime } from '../lib/format';
import { useDashboard, useDiscordStatus } from '../lib/queries';

function Tile({
  label,
  value,
  to,
  tone,
}: {
  label: string;
  value: ReactNode;
  to?: string;
  tone?: 'bad' | 'warn';
}) {
  const body = (
    <Card className={`h-full p-4 ${to ? 'hover:border-accent' : ''}`}>
      <div className="text-xs text-muted">{label}</div>
      <div
        className={`mt-1 text-2xl font-semibold tabular-nums ${
          tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : 'text-white'
        }`}
      >
        {value}
      </div>
    </Card>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

export function DashboardPage() {
  const dashboard = useDashboard();
  const discord = useDiscordStatus();
  const data = dashboard.data;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Dashboard" />
      {dashboard.isPending && <Spinner />}
      {dashboard.isError && <ErrorBox>{errorMessage(dashboard.error)}</ErrorBox>}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Tile label="Messages today" value={data.messages} to="/log" />
            <Tile
              label="Failed today"
              value={data.failed}
              to="/log?status=failed"
              tone={data.failed ? 'bad' : undefined}
            />
            <Tile
              label="Unrouted today"
              value={data.unrouted}
              to="/log?status=unrouted"
              tone={data.unrouted ? 'warn' : undefined}
            />
            <Tile
              label="Waiting to send"
              value={data.queueDepth}
              tone={data.queueDepth > 10 ? 'warn' : undefined}
            />
            <Tile
              label="Discarded today"
              value={data.discarded}
              to="/discarded"
              tone={data.discarded ? 'warn' : undefined}
            />
            <Tile
              label="Discord"
              value={
                <span className="text-base">
                  {discord.data?.connected
                    ? 'Connected'
                    : discord.data?.configured
                      ? 'Offline'
                      : 'Not set up'}
                </span>
              }
              to="/settings"
              tone={discord.data && !discord.data.connected ? 'bad' : undefined}
            />
          </div>

          <Card className="min-w-0 overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead className="border-b border-line text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 font-normal">Source</th>
                  <th className="px-3 py-2 text-right font-normal">Today</th>
                  <th className="px-3 py-2 font-normal">Last message</th>
                </tr>
              </thead>
              <tbody>
                {data.sources.map((source) => (
                  <tr key={source.id} className="border-b border-line">
                    <td className="px-3 py-2">
                      <Link
                        to={`/sources?s=${encodeURIComponent(source.id)}`}
                        className="text-white hover:underline"
                      >
                        {source.name}
                      </Link>{' '}
                      {!source.enabled && <Badge>off</Badge>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <Link to={`/log?source=${encodeURIComponent(source.id)}`} className="hover:underline">
                        {source.messages}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-muted">
                      {source.lastReceivedAt ? formatTime(source.lastReceivedAt) : 'never'}
                    </td>
                  </tr>
                ))}
                {data.sources.length === 0 && (
                  <tr>
                    <td colSpan={3} className="p-6 text-center text-muted">
                      No sources yet.{' '}
                      <Link to="/sources" className="text-accent hover:underline">
                        Add one
                      </Link>
                      .
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}

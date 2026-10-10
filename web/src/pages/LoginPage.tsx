import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';
import { PageSpinner, useRefreshSession } from '../components/Layout';
import { Button, Card, ErrorBox, TextField } from '../components/ui';
import { api, ApiRequestError } from '../lib/api';
import { useSession } from '../lib/queries';

export function LoginPage() {
  const session = useSession();
  const refresh = useRefreshSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const login = useMutation({
    mutationFn: () => api('/login', { method: 'POST', body: { username, password } }),
    onSuccess: refresh,
  });

  if (session.isPending) return <PageSpinner />;
  if (session.data && !session.data.hasAdmin) return <Navigate to="/setup" replace />;
  if (session.data?.authenticated) return <Navigate to="/" replace />;

  const fields = login.error instanceof ApiRequestError ? login.error.fieldErrors() : {};
  const submit = (event: FormEvent) => {
    event.preventDefault();
    login.mutate();
  };

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <Card className="w-full max-w-sm p-6">
        <form onSubmit={submit} className="space-y-4">
          <h1 className="text-xl font-semibold text-white">Log in to Notify Hub</h1>
          {login.error && !Object.keys(fields).length && <ErrorBox>{login.error.message}</ErrorBox>}
          <TextField
            label="Username"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            error={fields.username}
            autoFocus
          />
          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={fields.password}
          />
          <Button type="submit" className="w-full" disabled={login.isPending}>
            {login.isPending ? 'Logging in…' : 'Log in'}
          </Button>
        </form>
      </Card>
    </div>
  );
}

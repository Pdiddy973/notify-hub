import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { RequireSession } from './components/Layout';
import { AdaptersPage } from './pages/AdaptersPage';
import { DashboardPage } from './pages/DashboardPage';
import { DiscardedPage } from './pages/DiscardedPage';
import { LogPage } from './pages/LogPage';
import { LoginPage } from './pages/LoginPage';
import { MutedPage } from './pages/MutedPage';
import { RoutingPage } from './pages/RoutingPage';
import { SettingsPage } from './pages/SettingsPage';
import { SetupPage } from './pages/SetupPage';
import { SourcesPage } from './pages/SourcesPage';

const router = createBrowserRouter([
  { path: '/setup', element: <SetupPage /> },
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireSession />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: '/dashboard', element: <DashboardPage /> },
      { path: '/log', element: <LogPage /> },
      { path: '/sources', element: <SourcesPage /> },
      { path: '/routing', element: <RoutingPage /> },
      { path: '/discarded', element: <DiscardedPage /> },
      { path: '/muted', element: <MutedPage /> },
      { path: '/adapters', element: <AdaptersPage /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '*', element: <Navigate to="/dashboard" replace /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}

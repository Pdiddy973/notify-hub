import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { RequireSession } from './components/Layout';
import { LogPage } from './pages/LogPage';
import { LoginPage } from './pages/LoginPage';
import { SetupPage } from './pages/SetupPage';

const router = createBrowserRouter([
  { path: '/setup', element: <SetupPage /> },
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireSession />,
    children: [
      { index: true, element: <Navigate to="/log" replace /> },
      { path: '/log', element: <LogPage /> },
      { path: '*', element: <Navigate to="/log" replace /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}

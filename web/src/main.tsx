import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
import { ApiRequestError } from './lib/api';
import { keys } from './lib/queries';

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({
    // An expired session sends the app back to the login page.
    onError: (error) => {
      if (error instanceof ApiRequestError && error.status === 401) {
        void queryClient.invalidateQueries({ queryKey: keys.session });
      }
    },
  }),
  defaultOptions: {
    queries: {
      // Client errors will not fix themselves; retry only server and network errors.
      retry: (count, error) => !(error instanceof ApiRequestError && error.status < 500) && count < 2,
    },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);

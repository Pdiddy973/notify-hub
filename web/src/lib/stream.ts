import type { MessageSummary } from '@notify-hub/shared';
import { useEffect, useRef, useState } from 'react';

export type StreamState = 'connecting' | 'live' | 'reconnecting';

// Subscribes to the live log; the browser reconnects on its own after a drop.
export function useMessageStream(onRow: (row: MessageSummary) => void): StreamState {
  const [state, setState] = useState<StreamState>('connecting');
  const handler = useRef(onRow);
  handler.current = onRow;

  useEffect(() => {
    const source = new EventSource('/api/stream');
    source.onopen = () => setState('live');
    source.onerror = () => setState('reconnecting');
    source.addEventListener('message', (event) => {
      handler.current(JSON.parse((event as MessageEvent<string>).data) as MessageSummary);
    });
    return () => source.close();
  }, []);

  return state;
}

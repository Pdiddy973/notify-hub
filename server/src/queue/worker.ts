export interface WorkerOptions {
  // Sends the next queued delivery; resolves false when nothing is queued.
  deliverNext(): Promise<boolean>;
  // False while the bot is offline; deliveries then wait in the queue.
  isReady(): boolean;
  // How long to wait when idle or offline before checking again.
  idleMs?: number;
  onError?(error: unknown): void;
}

export interface Worker {
  start(): void;
  // Ends the wait early, for example after an enqueue.
  wake(): void;
  // Resolves once the current delivery has finished.
  stop(): Promise<void>;
}

// Works through the queue in order, one delivery at a time.
export function createWorker({ deliverNext, isReady, idleMs = 1000, onError }: WorkerOptions): Worker {
  let running = false;
  let loop: Promise<void> | undefined;
  let wakeUp: (() => void) | undefined;

  const idle = () =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(done, idleMs);
      function done() {
        clearTimeout(timer);
        wakeUp = undefined;
        resolve();
      }
      wakeUp = done;
    });

  async function run() {
    while (running) {
      let sent = false;
      if (isReady()) {
        try {
          sent = await deliverNext();
        } catch (error) {
          onError?.(error);
        }
      }
      if (!sent && running) await idle();
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      loop = run();
    },
    wake() {
      wakeUp?.();
    },
    async stop() {
      running = false;
      wakeUp?.();
      await loop;
    },
  };
}

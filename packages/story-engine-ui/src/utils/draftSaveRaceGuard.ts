export interface DraftSaveRaceGuard {
  readonly isRunning: boolean;
  run(task: () => Promise<void>): Promise<void>;
}

export function createDraftSaveRaceGuard(): DraftSaveRaceGuard {
  let running = false;
  let pendingTask: (() => Promise<void>) | null = null;
  let drainPromise: Promise<void> | null = null;

  return {
    get isRunning() {
      return running;
    },

    run(task: () => Promise<void>): Promise<void> {
      if (running) {
        pendingTask = task;
        return drainPromise ?? Promise.resolve();
      }

      drainPromise = (async () => {
        running = true;
        try {
          let nextTask: (() => Promise<void>) | null = task;
          while (nextTask) {
            const currentTask = nextTask;
            nextTask = null;
            await currentTask();
            nextTask = pendingTask;
            pendingTask = null;
          }
        } finally {
          pendingTask = null;
          running = false;
          drainPromise = null;
        }
      })();

      return drainPromise;
    },
  };
}

import type { AppConfig } from "./config.ts";

const workerPaths = {
  mood: "process-mood-queue",
  final: "process-final-queue",
  upscale: "process-upscale-queue",
} as const;

export type WakeWorkerKind = keyof typeof workerPaths;

/** Fire-and-forget worker invocation so queued work starts immediately. */
export function wakeWorkers(
  config: AppConfig,
  kind: WakeWorkerKind,
  count = 1,
): void {
  const path = workerPaths[kind];
  const url = `${config.supabaseUrl}/functions/v1/${path}`;
  const headers = {
    Authorization: `Bearer ${config.serviceRoleKey}`,
    "Content-Type": "application/json",
  };

  for (let i = 0; i < count; i++) {
    fetch(url, { method: "POST", headers, body: "{}" })
      .then((response) => {
        if (!response.ok) {
          console.warn(JSON.stringify({
            level: "warn",
            event: "worker_wake_failed",
            worker: kind,
            status: response.status,
          }));
        }
      })
      .catch((error) => {
        console.warn(JSON.stringify({
          level: "warn",
          event: "worker_wake_error",
          worker: kind,
          error: error instanceof Error ? error.message : String(error),
        }));
      });
  }
}

/**
 * A single process-mood-queue invocation already reads up to `moodBatch`
 * messages and processes all of them concurrently in one `Promise.all`
 * (see worker.ts). Firing multiple concurrent wake calls here does not
 * parallelize the batch further; it only spins up redundant invocations
 * that race each other for the same `queue_read` messages and the same
 * global `worker_leases` slots, which can starve one message out of its
 * lease and leave it stuck retrying indefinitely. One wake is enough.
 */
export function wakeMoodWorkers(config: AppConfig): void {
  wakeWorkers(config, "mood");
}

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { requireServiceRole } from "./auth.ts";
import { type AppConfig, loadConfig } from "./config.ts";
import { serviceClient } from "./db.ts";
import { corsHeaders, handleError, json, requestId } from "./http.ts";
import { generateImage } from "./openrouter.ts";
import { signedObjectUrl, uploadGeneratedImage } from "./storage.ts";

export type WorkerKind = "mood" | "final" | "upscale";
type QueueMessage = { msg_id: number; message: { generation_id?: unknown } };
type Generation = {
  id: string;
  job_id: string;
  user_id: string;
  kind: "mood" | "final" | "revision" | "upscale";
  status: string;
  prompt: string;
  model: string;
  resolution: string;
  seed: number | null;
  attempts: number;
  source_generation_id: string | null;
};

const queueByKind = {
  mood: "mood_generation",
  final: "final_generation",
  upscale: "upscale_generation",
} as const;

/** Retry window for messages that couldn't get a lease or claim; keeps retries fast. */
const busyRetrySeconds = 5;

function batchSize(config: AppConfig, kind: WorkerKind): number {
  return kind === "mood"
    ? config.moodBatch
    : kind === "final"
    ? config.finalBatch
    : config.upscaleBatch;
}

function dimensions(resolution: string): [number | null, number | null] {
  const match = /^(\d+)x(\d+)$/.exec(resolution);
  return match ? [Number(match[1]), Number(match[2])] : [null, null];
}

async function rpc<T>(
  db: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data as T;
}

async function processMessage(
  db: SupabaseClient,
  config: AppConfig,
  queue: string,
  workerId: string,
  item: QueueMessage,
): Promise<"complete" | "retry" | "busy" | "terminal"> {
  const generationId = item.message?.generation_id;
  if (typeof generationId !== "string") {
    await rpc(db, "queue_archive", { p_queue: queue, p_msg_id: item.msg_id });
    return "terminal";
  }

  const leases = await rpc<Array<{ slot_no: number; lease_token: string }>>(
    db,
    "acquire_generation_lease",
    {
      p_worker_id: workerId,
      p_generation_id: generationId,
      p_queue_name: queue,
      p_max_slots: config.maxConcurrent,
      p_ttl_seconds: config.leaseSeconds,
    },
  );
  const lease = leases[0];
  if (!lease) {
    // No free concurrency slot right now. The message was already pulled
    // invisible for the full visibility timeout by queue_read; shrink that
    // back down so it's retried in seconds, not minutes, once a slot frees up.
    await rpc(db, "queue_set_visibility", {
      p_queue: queue,
      p_msg_id: item.msg_id,
      p_visibility: busyRetrySeconds,
    }).catch((error) => console.error("busy_requeue_failed", error));
    return "busy";
  }

  let claimed: Generation | undefined;
  try {
    const rows = await rpc<Generation[]>(db, "worker_claim_generation", {
      p_generation_id: generationId,
      p_stale_seconds: config.leaseSeconds,
    });
    claimed = rows[0];
    if (!claimed) {
      const { data } = await db.from("job_generations").select("status").eq("id", generationId)
        .maybeSingle();
      if (data && ["complete", "failed", "cancelled"].includes(data.status)) {
        await rpc(db, "queue_delete", { p_queue: queue, p_msg_id: item.msg_id });
        return "terminal";
      }
      await rpc(db, "queue_set_visibility", {
        p_queue: queue,
        p_msg_id: item.msg_id,
        p_visibility: busyRetrySeconds,
      }).catch((error) => console.error("busy_requeue_failed", error));
      return "busy";
    }

    let references: string[] | undefined;
    if (claimed.source_generation_id) {
      const { data: source, error } = await db.from("job_generations")
        .select("object_path").eq("id", claimed.source_generation_id).eq("status", "complete")
        .single();
      if (error || !source?.object_path) throw new Error("Source image is not available");
      references = [
        await signedObjectUrl(db, source.object_path, Math.max(config.signedUrlSeconds, 600)),
      ];
    }

    const output = await generateImage(config, {
      model: claimed.model,
      prompt: claimed.prompt,
      resolution: claimed.resolution,
      inputReferences: references,
      seed: claimed.seed ?? undefined,
    });
    const path = await uploadGeneratedImage(
      db,
      claimed.user_id,
      claimed.job_id,
      claimed.id,
      output.bytes,
      output.mimeType,
    );
    const [width, height] = dimensions(claimed.resolution);
    const completed = await rpc<boolean>(db, "worker_complete_generation", {
      p_generation_id: claimed.id,
      p_object_path: path,
      p_mime_type: output.mimeType,
      p_width: width,
      p_height: height,
      p_request_id: output.requestId,
      p_cost_usd: output.costUsd,
      p_usage: output.usage,
    });
    if (!completed) throw new Error("Generation completion was rejected");
    await rpc(db, "queue_delete", { p_queue: queue, p_msg_id: item.msg_id });
    return "complete";
  } catch (error) {
    if (!claimed) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const result = await rpc<string>(db, "worker_fail_generation", {
      p_generation_id: claimed.id,
      p_error: message,
      p_max_attempts: config.maxRetries,
    });
    if (result === "failed") {
      await rpc(db, "queue_archive", { p_queue: queue, p_msg_id: item.msg_id });
      return "terminal";
    }
    const backoff = Math.min(
      900,
      config.visibilitySeconds * (2 ** Math.max(0, claimed.attempts - 1)),
    );
    await rpc(db, "queue_set_visibility", {
      p_queue: queue,
      p_msg_id: item.msg_id,
      p_visibility: backoff,
    });
    return "retry";
  } finally {
    await rpc(db, "release_generation_lease", {
      p_slot_no: lease.slot_no,
      p_lease_token: lease.lease_token,
    }).catch((error) => console.error("lease_release_failed", error));
  }
}

export function serveWorker(kind: WorkerKind): void {
  Deno.serve(async (req) => {
    const id = requestId(req);
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: { code: "method_not_allowed" } }, 405);
    try {
      const config = loadConfig();
      requireServiceRole(req, config);
      const db = serviceClient(config);
      const queue = queueByKind[kind];
      const messages = await rpc<QueueMessage[]>(db, "queue_read", {
        p_queue: queue,
        p_visibility: config.visibilitySeconds,
        p_quantity: batchSize(config, kind),
      });
      const workerId = `${kind}:${id}`;
      const results = { complete: 0, retry: 0, busy: 0, terminal: 0 };
      await Promise.all(messages.map(async (message) => {
        const result = await processMessage(db, config, queue, workerId, message);
        results[result]++;
      }));
      console.log(JSON.stringify({
        level: "info",
        request_id: id,
        worker: kind,
        claimed: messages.length,
        results,
        max_concurrent: config.maxConcurrent,
      }));
      return json({ worker: kind, claimed: messages.length, results, request_id: id });
    } catch (error) {
      return handleError(error, id);
    }
  });
}

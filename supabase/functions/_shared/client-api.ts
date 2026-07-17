import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { requireUser } from "./auth.ts";
import { loadConfig } from "./config.ts";
import { serviceClient } from "./db.ts";
import { body, corsHeaders, handleError, HttpError, json, requestId } from "./http.ts";
import { deleteJobAssets, signedObjectUrl } from "./storage.ts";
import { stringField, uuidField } from "./validation.ts";
import { wakeMoodWorkers, wakeWorkers } from "./wake-workers.ts";

export type ClientAction =
  | "create-job"
  | "regenerate-moods"
  | "select-mood"
  | "request-changes"
  | "request-upscale"
  | "get-signed-image"
  | "cancel-job"
  | "delete-job";

function rpcError(error: { message: string }): never {
  const message = error.message.toLowerCase();
  if (message.includes("rate_limit_exceeded")) {
    throw new HttpError(429, "rate_limit_exceeded", "Too many jobs were created; try again later");
  }
  if (message.includes("not_found") || message.includes("not ready")) {
    throw new HttpError(404, "not_found", "The requested job or image was not found");
  }
  if (message.includes("invalid_job_state") || message.includes("not_ready")) {
    throw new HttpError(409, "invalid_state", "The job is not ready for this action");
  }
  throw new HttpError(400, "request_rejected", "The request is not valid for this job");
}

async function call(
  db: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await db.rpc(name, args);
  if (error) rpcError(error);
  return data;
}

async function verifyTurnstile(
  secret: string | undefined,
  input: Record<string, unknown>,
  req: Request,
): Promise<void> {
  if (!secret) return;
  const token = input.turnstile_token;
  if (typeof token !== "string" || token.length < 10 || token.length > 2048) {
    throw new HttpError(
      400,
      "verification_required",
      "Complete the verification before creating artwork",
    );
  }
  const form = new URLSearchParams({ secret, response: token });
  const remoteIp = req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (remoteIp) form.set("remoteip", remoteIp);
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const result = await response.json().catch(() => null) as { success?: boolean } | null;
  if (!response.ok || !result?.success) {
    throw new HttpError(403, "verification_failed", "Verification failed; refresh and try again");
  }
}

async function anonymousIpSubject(req: Request): Promise<string | undefined> {
  const address = req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (!address) return undefined;
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(address)),
  ).slice(0, 16);
  digest[6] = (digest[6] & 0x0f) | 0x40;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const value = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${
    value.slice(16, 20)
  }-${value.slice(20)}`;
}

export function serveClientAction(action: ClientAction): void {
  Deno.serve(async (req) => {
    const id = requestId(req);
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: { code: "method_not_allowed" } }, 405);
    try {
      const config = loadConfig();
      const auth = await requireUser(req, config);
      const input = await body(req);
      const db = serviceClient(config);

      if (action === "create-job") {
        const ipSubject = await anonymousIpSubject(req);
        if (ipSubject) {
          await call(db, "assert_rate_limit", {
            p_subject_id: ipSubject,
            p_action: "create_job_ip",
            p_limit: config.createIpRateLimit,
            p_window_seconds: 3600,
          });
        }
        await verifyTurnstile(config.turnstileSecret, input, req);
        const jobId = await call(db, "api_create_job", {
          p_user_id: auth.user.id,
          p_prompt: stringField(input, "prompt", 3, 2000),
          p_model: config.moodModel,
          p_resolution: config.moodResolution,
          p_rate_limit: config.createRateLimit,
        });
        wakeMoodWorkers(config);
        return json({ job_id: jobId, request_id: id }, 202);
      }
      const jobId = uuidField(input, "job_id");
      if (action === "regenerate-moods") {
        const round = await call(db, "api_regenerate_moods", {
          p_user_id: auth.user.id,
          p_job_id: jobId,
          p_model: config.moodModel,
          p_resolution: config.moodResolution,
        });
        wakeMoodWorkers(config);
        return json({ job_id: jobId, mood_round: round, request_id: id }, 202);
      }
      if (action === "select-mood") {
        let selectedGenerationId: string;
        if (typeof input.generation_id === "string") {
          selectedGenerationId = uuidField(input, "generation_id");
        } else {
          const moodSlot = input.mood_index;
          if (!Number.isInteger(moodSlot) || (moodSlot as number) < 0 || (moodSlot as number) > 3) {
            throw new HttpError(400, "invalid_input", "generation_id or mood_index is required");
          }
          const { data: job } = await db.from("album_jobs").select("mood_round")
            .eq("id", jobId).eq("user_id", auth.user.id).single();
          if (!job) throw new HttpError(404, "not_found", "The requested job was not found");
          const { data: mood } = await db.from("job_generations").select("id")
            .eq("job_id", jobId).eq("kind", "mood").eq("mood_round", job.mood_round)
            .eq("mood_slot", moodSlot).eq("status", "complete").single();
          if (!mood) throw new HttpError(409, "invalid_state", "That mood is not ready");
          selectedGenerationId = mood.id;
        }
        const generationId = await call(db, "api_select_mood", {
          p_job_id: jobId,
          p_user_id: auth.user.id,
          p_generation_id: selectedGenerationId,
          p_model: config.finalModel,
          p_resolution: config.finalResolution,
        });
        wakeWorkers(config, "final");
        return json({ job_id: jobId, generation_id: generationId, request_id: id }, 202);
      }
      if (action === "request-changes") {
        const generationId = await call(db, "api_request_changes", {
          p_job_id: jobId,
          p_user_id: auth.user.id,
          p_changes: typeof input.changes === "string"
            ? stringField(input, "changes", 3, 1000)
            : stringField(input, "change_prompt", 3, 1000),
          p_model: config.finalModel,
          p_resolution: config.finalResolution,
        });
        wakeWorkers(config, "final");
        return json({ job_id: jobId, generation_id: generationId, request_id: id }, 202);
      }
      if (action === "request-upscale") {
        const generationId = await call(db, "api_request_upscale", {
          p_user_id: auth.user.id,
          p_job_id: jobId,
          p_model: config.finalModel,
          p_resolution: config.upscaleResolution,
        });
        wakeWorkers(config, "upscale");
        return json({ job_id: jobId, generation_id: generationId, request_id: id }, 202);
      }
      if (action === "cancel-job") {
        const cancelled = await call(db, "api_cancel_job", {
          p_user_id: auth.user.id,
          p_job_id: jobId,
        });
        if (!cancelled) throw new HttpError(409, "invalid_state", "This job cannot be cancelled");
        return json({ job_id: jobId, cancelled: true, request_id: id });
      }
      if (action === "delete-job") {
        await deleteJobAssets(db, auth.user.id, jobId);
        const deleted = await call(db, "api_delete_job", {
          p_user_id: auth.user.id,
          p_job_id: jobId,
        });
        if (!deleted) throw new HttpError(404, "not_found", "The requested job was not found");
        return json({ job_id: jobId, deleted: true, request_id: id });
      }

      const generationId = uuidField(input, "generation_id");
      const { data: generation, error } = await db.from("job_generations")
        .select("id,job_id,user_id,status,object_path,mime_type")
        .eq("id", generationId).eq("job_id", jobId).eq("status", "complete").maybeSingle();
      if (
        error || !generation?.object_path || generation.user_id !== auth.user.id ||
        !generation.object_path.startsWith(`${auth.user.id}/${jobId}/`)
      ) {
        throw new HttpError(404, "image_not_found", "The requested image was not found");
      }
      const signedUrl = await signedObjectUrl(
        serviceClient(config),
        generation.object_path,
        config.signedUrlSeconds,
      );
      return json({
        generation_id: generationId,
        url: signedUrl,
        expires_in: config.signedUrlSeconds,
        mime_type: generation.mime_type,
        request_id: id,
      });
    } catch (error) {
      return handleError(error, id);
    }
  });
}

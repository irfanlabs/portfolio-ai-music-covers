export type AppConfig = ReturnType<typeof loadConfig>;

function text(name: string, fallback?: string): string {
  const value = Deno.env.get(name)?.trim() || fallback;
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optionalText(name: string): string | undefined {
  return Deno.env.get(name)?.trim() || undefined;
}

function integer(name: string, fallback: number, min: number, max: number): number {
  const raw = Deno.env.get(name);
  const value = raw === undefined ? fallback : Number.parseInt(raw, 10);
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`);
  return Math.max(min, Math.min(max, value));
}

export function loadConfig() {
  return Object.freeze({
    supabaseUrl: text("SUPABASE_URL"),
    anonKey: text("SUPABASE_ANON_KEY"),
    serviceRoleKey: text("SUPABASE_SERVICE_ROLE_KEY"),
    openRouterKey: text("OPENROUTER_API_KEY"),
    openRouterBaseUrl: text("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
    openRouterReferer: text("OPENROUTER_HTTP_REFERER", "http://localhost:5173"),
    turnstileSecret: optionalText("TURNSTILE_SECRET_KEY"),
    moodModel: text("MOOD_IMAGE_MODEL", "google/gemini-2.5-flash-image"),
    finalModel: text("FINAL_IMAGE_MODEL", "google/gemini-3-pro-image"),
    moodResolution: text("MOOD_IMAGE_RESOLUTION", "1K"),
    finalResolution: text("FINAL_IMAGE_RESOLUTION", "2K"),
    upscaleResolution: text("UPSCALE_IMAGE_RESOLUTION", "4K"),
    // Keep headroom above the largest worker batch size (mood defaults to 4).
    // worker_leases is a single global pool shared by every queue and every
    // job; sizing it equal to (or below) one batch leaves zero slack for
    // unrelated concurrent work (other jobs, retries, final/upscale queues),
    // which starves one message out of a lease and leaves it stuck retrying.
    maxConcurrent: integer("MAX_CONCURRENT_GENERATIONS", 8, 1, 100),
    moodBatch: integer("MOOD_WORKER_BATCH_SIZE", 4, 1, 20),
    finalBatch: integer("FINAL_WORKER_BATCH_SIZE", 2, 1, 20),
    upscaleBatch: integer("UPSCALE_WORKER_BATCH_SIZE", 1, 1, 10),
    visibilitySeconds: integer("QUEUE_VISIBILITY_TIMEOUT_SECONDS", 180, 30, 900),
    leaseSeconds: integer("GENERATION_LEASE_SECONDS", 240, 30, 900),
    maxRetries: integer("MAX_RETRIES", 3, 1, 10),
    signedUrlSeconds: integer("SIGNED_URL_TTL_SECONDS", 300, 30, 3600),
    openRouterTimeoutMs: integer("OPENROUTER_TIMEOUT_MS", 90_000, 5_000, 240_000),
    createRateLimit: integer("CREATE_JOB_RATE_LIMIT_PER_HOUR", 10, 1, 1000),
    createIpRateLimit: integer(
      "CREATE_JOB_IP_RATE_LIMIT_PER_HOUR",
      30,
      1,
      5000,
    ),
  });
}

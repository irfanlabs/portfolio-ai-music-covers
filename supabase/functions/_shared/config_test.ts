import { loadConfig } from "./config.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test("loadConfig applies safe defaults and bounds capacity", () => {
  const values: Record<string, string> = {
    SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_ANON_KEY: "test-anon",
    SUPABASE_SERVICE_ROLE_KEY: "test-service",
    OPENROUTER_API_KEY: "test-openrouter",
    MAX_CONCURRENT_GENERATIONS: "999",
    MOOD_WORKER_BATCH_SIZE: "0",
    CREATE_JOB_IP_RATE_LIMIT_PER_HOUR: "45",
  };
  for (const [name, value] of Object.entries(values)) Deno.env.set(name, value);

  const config = loadConfig();
  assertEquals(config.maxConcurrent, 100);
  assertEquals(config.moodBatch, 1);
  assertEquals(config.finalModel, "google/gemini-3-pro-image");
  assertEquals(config.createIpRateLimit, 45);
  assertEquals(config.signedUrlSeconds, 300);
});

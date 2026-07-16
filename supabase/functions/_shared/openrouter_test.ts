import type { AppConfig } from "./config.ts";
import { generateImage } from "./openrouter.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("generateImage sends normalized 3:4 references and parses base64", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        id: "request-1",
        data: [{ b64_json: "AQ==", mime_type: "image/png" }],
        usage: { cost: 0.03 },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json", "x-request-id": "request-1" },
      },
    );
  };

  try {
    const config = {
      openRouterBaseUrl: "https://openrouter.test/api/v1",
      openRouterKey: "test-key",
      openRouterReferer: "https://studio.test",
    } as AppConfig;
    const image = await generateImage(config, {
      model: "google/gemini-3-pro-image",
      prompt: "Album cover",
      resolution: "2K",
      inputReferences: ["https://signed.test/reference.png"],
      seed: 42,
    });

    assert(requestBody?.aspect_ratio === "3:4", "Expected a 3:4 request");
    assert(requestBody?.resolution === "2K", "Expected resolution tier");
    const references = requestBody?.input_references as Array<{
      image_url?: { url?: string };
    }>;
    assert(
      references[0]?.image_url?.url === "https://signed.test/reference.png",
      "Expected an OpenRouter ContentPartImage reference",
    );
    assert(image.bytes[0] === 1, "Expected decoded image bytes");
    assert(image.costUsd === 0.03, "Expected usage cost");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

import type { AppConfig } from "./config.ts";

export type GeneratedImage = {
  bytes: Uint8Array;
  mimeType: string;
  requestId: string | null;
  costUsd: number | null;
  usage: Record<string, unknown>;
};

type ImagePayload = {
  b64_json?: unknown;
  url?: unknown;
  image_url?: unknown;
  mime_type?: unknown;
};

function decodeBase64(value: string): Uint8Array {
  const raw = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  const binary = atob(raw);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function imageCandidates(payload: Record<string, unknown>): ImagePayload[] {
  const data = Array.isArray(payload.data) ? payload.data : [];
  const images = Array.isArray(payload.images) ? payload.images : [];
  return [...data, ...images].filter((item): item is ImagePayload =>
    !!item && typeof item === "object"
  );
}

export async function generateImage(
  config: AppConfig,
  input: {
    model: string;
    prompt: string;
    resolution: string;
    inputReferences?: string[];
    seed?: number;
  },
): Promise<GeneratedImage> {
  // Bound the request ourselves rather than letting the platform hard-kill
  // the isolate on its own wall-clock limit, which would skip our catch
  // block and leave the generation stuck in "processing" forever.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.openRouterTimeoutMs);

  let response: Response;
  try {
    response = await fetch(`${config.openRouterBaseUrl}/images/generations`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${config.openRouterKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": config.openRouterReferer,
        "X-Title": "AI Image Studio",
      },
      body: JSON.stringify({
        model: input.model,
        prompt: input.prompt,
        aspect_ratio: "3:4",
        resolution: input.resolution,
        input_references: (input.inputReferences ?? []).map((url) => ({
          type: "image_url",
          image_url: { url },
        })),
        ...(input.seed === undefined ? {} : { seed: input.seed }),
      }),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`OpenRouter request timed out after ${config.openRouterTimeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const raw = await response.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`OpenRouter returned non-JSON (${response.status})`);
  }
  if (!response.ok) {
    const providerMessage = typeof payload.error === "object" && payload.error &&
        "message" in payload.error
      ? String(payload.error.message)
      : `HTTP ${response.status}`;
    throw new Error(`OpenRouter image generation failed: ${providerMessage}`);
  }

  const image = imageCandidates(payload)[0];
  if (!image) throw new Error("OpenRouter response did not contain an image");
  const mimeType = typeof image.mime_type === "string" ? image.mime_type : "image/png";
  let bytes: Uint8Array;
  if (typeof image.b64_json === "string") {
    bytes = decodeBase64(image.b64_json);
  } else {
    const url = typeof image.url === "string"
      ? image.url
      : typeof image.image_url === "string"
      ? image.image_url
      : null;
    if (!url) throw new Error("OpenRouter image had neither b64_json nor URL");
    const downloadController = new AbortController();
    const downloadTimeout = setTimeout(
      () => downloadController.abort(),
      config.openRouterTimeoutMs,
    );
    let imageResponse: Response;
    try {
      imageResponse = await fetch(url, { signal: downloadController.signal });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `Downloading generated image timed out after ${config.openRouterTimeoutMs}ms`,
        );
      }
      throw error;
    } finally {
      clearTimeout(downloadTimeout);
    }
    if (!imageResponse.ok) {
      throw new Error(`Could not download generated image (${imageResponse.status})`);
    }
    bytes = new Uint8Array(await imageResponse.arrayBuffer());
  }
  if (bytes.byteLength === 0 || bytes.byteLength > 20 * 1024 * 1024) {
    throw new Error("Generated image size is invalid");
  }

  const usage = payload.usage && typeof payload.usage === "object"
    ? payload.usage as Record<string, unknown>
    : {};
  const cost = typeof usage.cost === "number"
    ? usage.cost
    : typeof payload.cost === "number"
    ? payload.cost
    : null;
  const requestId = response.headers.get("x-request-id") ||
    (typeof payload.id === "string" ? payload.id : null);
  return { bytes, mimeType, requestId, costUsd: cost, usage };
}

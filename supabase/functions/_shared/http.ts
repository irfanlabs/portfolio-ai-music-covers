export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

export function handleError(error: unknown, requestId: string): Response {
  const known = error instanceof HttpError;
  const message = known ? error.message : "The request could not be completed";
  const code = known ? error.code : "internal_error";
  console.error(JSON.stringify({
    level: "error",
    request_id: requestId,
    code,
    error: error instanceof Error ? error.message : String(error),
  }));
  return json({ error: { code, message }, request_id: requestId }, known ? error.status : 500);
}

export function requestId(req: Request): string {
  return req.headers.get("x-request-id")?.slice(0, 100) || crypto.randomUUID();
}

export async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const value = await req.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "invalid_json", "A JSON object is required");
  }
}

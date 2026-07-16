import type { User } from "npm:@supabase/supabase-js@2";
import type { AppConfig } from "./config.ts";
import { serviceClient } from "./db.ts";
import { HttpError } from "./http.ts";

export type AuthContext = { jwt: string; user: User };

function bearer(req: Request): string {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new HttpError(401, "authentication_required", "A valid anonymous session is required");
  }
  return header.slice(7).trim();
}

export async function requireUser(req: Request, config: AppConfig): Promise<AuthContext> {
  const jwt = bearer(req);
  const { data, error } = await serviceClient(config).auth.getUser(jwt);
  if (error || !data.user) {
    throw new HttpError(401, "invalid_session", "The anonymous session is invalid or expired");
  }
  return { jwt, user: data.user };
}

export function requireServiceRole(req: Request, config: AppConfig): void {
  const jwt = bearer(req);
  if (jwt.length !== config.serviceRoleKey.length) {
    throw new HttpError(401, "worker_unauthorized", "Worker authorization failed");
  }
  let mismatch = 0;
  for (let i = 0; i < jwt.length; i++) {
    mismatch |= jwt.charCodeAt(i) ^ config.serviceRoleKey.charCodeAt(i);
  }
  if (mismatch !== 0) {
    throw new HttpError(401, "worker_unauthorized", "Worker authorization failed");
  }
}

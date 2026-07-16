import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { AppConfig } from "./config.ts";

export function serviceClient(config: AppConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function userClient(config: AppConfig, jwt: string): SupabaseClient {
  return createClient(config.supabaseUrl, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

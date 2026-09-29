import "server-only";
import { type SupabaseClient, createClient } from "@supabase/supabase-js";
import { env, features } from "@/server/env";

let admin: SupabaseClient | null = null;

/**
 * Service-role client for the BFF. Never exposed to the browser; every call
 * site scopes queries by the authenticated user id explicitly.
 */
export function db(): SupabaseClient {
  if (!features.backend()) throw new BackendUnavailable();
  admin ??= createClient(env().NEXT_PUBLIC_SUPABASE_URL!, env().SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-application-name": "twinme-web" } },
  });
  return admin;
}

export class BackendUnavailable extends Error {
  constructor() {
    super("Backend is not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
  }
}

/** Throws on a Supabase error, returns data otherwise. */
export function must<T>(res: { data: T | null; error: { message: string; code?: string } | null }): T {
  if (res.error) {
    const e = new Error(res.error.message) as Error & { code?: string };
    e.code = res.error.code;
    throw e;
  }
  return res.data as T;
}

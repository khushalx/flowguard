import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicConfig } from "../env";
import { backendFetch } from "../server/transport";

export function adminClient() {
  const config = publicConfig();
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!config || !key)
    throw new Error(
      "Server database access is not configured. Set SUPABASE_SECRET_KEY.",
    );
  return createClient(config.url, key, {
    global: { fetch: backendFetch("supabase") },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

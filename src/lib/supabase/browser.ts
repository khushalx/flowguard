"use client";
import { createBrowserClient } from "@supabase/ssr";
import { publicConfig } from "../env";

// Reserved for browser Auth flows that need it. Workspace mutations use the
// server API; the application never reads or displays provider/session tokens.
export function browserClient() {
  const config = publicConfig();
  if (!config) throw new Error("Supabase is not configured.");
  return createBrowserClient(config.url, config.key);
}

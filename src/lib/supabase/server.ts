import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicConfig } from "../env";
import { backendFetch } from "../server/transport";

export async function serverClient() {
  const config = publicConfig();
  if (!config)
    throw new Error(
      "Supabase is not configured. Follow SETUP.md to enable your workspace.",
    );
  const store = await cookies();
  return createServerClient(config.url, config.key, {
    global: { fetch: backendFetch("supabase") },
    cookieOptions: {
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
    },
    cookies: {
      getAll: () => store.getAll(),
      setAll(values) {
        try {
          values.forEach(({ name, value, options }) =>
            store.set(name, value, options),
          );
        } catch {
          /* Server Components cannot set cookies; proxy refreshes sessions. */
        }
      },
    },
  });
}

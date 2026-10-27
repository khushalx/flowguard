import { z } from "zod";

export function publicConfig() {
  const result = z
    .object({
      url: z.string().url(),
      key: z
        .string()
        .min(20)
        .startsWith(
          "sb_publishable_",
          "Use the Supabase publishable key, never a secret or service-role key.",
        ),
    })
    .safeParse({
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    });
  return result.success ? result.data : null;
}

export function appOrigin() {
  const value = process.env.NEXT_PUBLIC_APP_URL;
  if (!value)
    throw new Error("Set NEXT_PUBLIC_APP_URL before enabling authentication.");
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    (process.env.NODE_ENV === "production" &&
      url.protocol !== "https:" &&
      !["localhost", "127.0.0.1"].includes(url.hostname))
  )
    throw new Error(
      "NEXT_PUBLIC_APP_URL must be the application's canonical origin (HTTPS in production).",
    );
  return url.origin;
}

export function safeReturnTo(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length > 2000 ||
    /[\\\x00-\x20]/.test(value)
  )
    return "/app";
  try {
    const decoded = decodeURIComponent(value);
    if (/[\\\x00-\x20]/.test(decoded) || decoded.startsWith("//"))
      return "/app";
    const url = new URL(value, "https://flowguard.invalid");
    return url.origin === "https://flowguard.invalid" &&
      (url.pathname === "/app" || url.pathname.startsWith("/app/"))
      ? url.pathname + url.search
      : "/app";
  } catch {
    return "/app";
  }
}

import { z } from "zod";

function readPublicConfig() {
  return z
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
}

export function publicConfig() {
  const result = readPublicConfig();
  return result.success ? result.data : null;
}

// Safe to render: these messages contain names and expected formats only.
// Keep GitHub App / privileged database credentials out of the sign-in gate.
export function authConfigurationIssues(): string[] {
  const issues: string[] = [];
  const result = readPublicConfig();
  if (!result.success) {
    const fields = new Set(result.error.issues.map((issue) => issue.path[0]));
    if (fields.has("url"))
      issues.push(
        "NEXT_PUBLIC_SUPABASE_URL is missing or invalid. Set it to your Supabase project URL.",
      );
    if (fields.has("key"))
      issues.push(
        "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing or invalid. Use the publishable key beginning with sb_publishable_, never a secret or service-role key.",
      );
  }
  try {
    appOrigin();
  } catch {
    issues.push(
      "NEXT_PUBLIC_APP_URL is missing or invalid. Set it to this application's canonical origin, with HTTPS in production and no path or query.",
    );
  }
  return issues;
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

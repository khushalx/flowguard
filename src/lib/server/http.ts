import "server-only";
import { platformError } from "./monitoring";
import { appOrigin } from "../env";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function sameOrigin(request: Request) {
  if (request.headers.get("origin") !== appOrigin())
    throw new AppError("Reload this page before trying again.", 403);
}
// Relative redirects preserve the browser's origin even behind a reverse proxy.
export function internalRedirect(path: string) {
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\r\n]/.test(path))
    throw new Error("Invalid internal redirect");
  return new Response(null, {
    status: 303,
    headers: { Location: path, "Cache-Control": "private, no-store" },
  });
}
export async function jsonBody(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new AppError("Send JSON data.", 415);
  if (Number(request.headers.get("content-length")) > 200_000)
    throw new AppError("This request is too large.", 413);
  const reader = request.body?.getReader();
  let size = 0;
  let text = "";
  const decoder = new TextDecoder();
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 200_000) {
          await reader.cancel();
          throw new AppError("This request is too large.", 413);
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      reader.releaseLock();
    }
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError("Invalid JSON.");
  }
}
export function apiError(error: unknown) {
  if (error instanceof AppError)
    return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof ZodError)
    return Response.json(
      { error: error.issues[0]?.message || "Check the submitted fields." },
      { status: 400 },
    );
  console.error(
    "FlowGuard request failed",
    error instanceof Error ? error.name : "Unknown error",
  );
  return Response.json(
    {
      error:
        "The operation could not be completed. Check server configuration and try again.",
    },
    { status: 503 },
  );
}
export function dbCheck(error: { code?: string; message: string } | null) {
  if (!error) return;
  platformError("database_failure", 503);
  console.error("FlowGuard database operation failed", {
    code: error.code ?? "unknown",
  });
  if (error.code === "23505")
    throw new AppError(
      "That record already exists. Choose a different name or use the existing record.",
      409,
    );
  if (error.code === "42501")
    throw new AppError(
      "You don’t have permission to change this resource.",
      403,
    );
  throw new AppError(
    "Database request failed. Confirm migrations are installed and try again.",
    503,
  );
}

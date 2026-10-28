import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { telemetryEvent } from "../monitoring";
const scope = new AsyncLocalStorage<{
  id: string;
  pending: Promise<unknown>[];
}>();
export function platformError(kind: string, status = 0, duration = 0) {
  const event = telemetryEvent(
    kind,
    scope.getStore()?.id || crypto.randomUUID(),
    status,
    duration,
  );
  console.info(event.message, event.tags);
  if (process.env.SENTRY_DSN) {
    const delivery = import("@sentry/nextjs")
      .then(async (s) => {
        s.captureEvent(event);
        await s.flush(500);
      })
      .catch(() => {});
    scope.getStore()?.pending.push(delivery);
  }
}
// Preserve each route's declared Next.js parameter signature.
export function monitored<T extends (...args: never[]) => Promise<Response>>(
  handler: T,
): T {
  return (async (...args: Parameters<T>) =>
    scope.run({ id: crypto.randomUUID(), pending: [] }, async () => {
      const started = performance.now();
      const response = await handler(...args);
      const ms = performance.now() - started;
      const id = scope.getStore()!.id;
      response.headers.set("X-Request-Id", id);
      const prior = response.headers.get("Server-Timing");
      response.headers.set(
        "Server-Timing",
        `${prior ? prior + ", " : ""}endpoint;dur=${Math.round(ms)}`,
      );
      if (response.status >= 500)
        platformError("server_error", response.status, ms);
      const request = args[0] as Request | undefined;
      if (
        request &&
        new URL(request.url).pathname.startsWith("/api/runner/") &&
        response.status >= 400
      )
        platformError("runner_callback_failure", response.status, ms);
      if (ms > 2000) platformError("slow_endpoint", response.status, ms);
      await Promise.allSettled(scope.getStore()!.pending);
      return response;
    })) as T;
}

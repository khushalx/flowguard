// Strict outbound allowlist: no exception text/stack, URLs, user identity,
// request payloads, breadcrumbs, headers, SQL, source context or replay data.
export type PlatformEvent = {
  event_id?: string;
  level?: "error" | "warning" | "info";
  message?: string;
  tags?: Record<string, string>;
  timestamp?: number;
};
const kinds = new Set([
  "server_error",
  "client_exception",
  "slow_endpoint",
  "database_failure",
  "auth_failure",
  "runner_callback_failure",
]);
export function telemetryEvent(
  kind: string,
  requestId: string,
  status = 0,
  durationMs = 0,
): PlatformEvent {
  return {
    level: kind === "slow_endpoint" ? "warning" : "error",
    message: kinds.has(kind) ? `FlowGuard ${kind}` : "FlowGuard server_error",
    tags: {
      platform: "flowguard",
      request_id: /^[a-f0-9-]{36}$/.test(requestId) ? requestId : "unavailable",
      status: String(Math.max(0, Math.min(599, status))),
      duration_ms: String(
        Math.max(0, Math.min(120000, Math.round(durationMs))),
      ),
    },
  };
}
export function scrubEvent(event: PlatformEvent): PlatformEvent {
  const kind = (event.message || "").replace("FlowGuard ", "");
  const clean = telemetryEvent(
    kind,
    event.tags?.request_id || "",
    Number(event.tags?.status) || 0,
    Number(event.tags?.duration_ms) || 0,
  );
  return {
    ...clean,
    ...(event.event_id ? { event_id: event.event_id } : {}),
    ...(event.timestamp ? { timestamp: event.timestamp } : {}),
  };
}

import { monitoringPrivacy } from "./lib/monitoring-options";
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.SENTRY_DSN) {
    try {
      const Sentry = await import("@sentry/nextjs");
      const { scrubEvent } = await import("./lib/monitoring");
      Sentry.init({
        dsn: process.env.SENTRY_DSN,
        dataCollection: monitoringPrivacy,
        defaultIntegrations: false,
        integrations: [],
        tracesSampleRate: 0,
        beforeSend: (event) => ({
          ...scrubEvent({
            event_id: event.event_id,
            timestamp: event.timestamp,
            message: event.message,
            tags: Object.fromEntries(
              Object.entries(event.tags || {}).map(([k, v]) => [k, String(v)]),
            ),
          }),
          type: event.type,
        }),
      });
    } catch {
      console.warn("FlowGuard optional monitoring could not initialize.");
    }
  }
}
export async function onRequestError() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { platformError } = await import("./lib/server/monitoring");
  platformError("server_error", 500);
}

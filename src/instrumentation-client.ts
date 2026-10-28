import { monitoringPrivacy } from "./lib/monitoring-options";
// Disabled builds do not download the optional monitoring SDK chunk.
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  void Promise.all([import("@sentry/nextjs"), import("./lib/monitoring")])
    .then(([Sentry, { scrubEvent, telemetryEvent }]) => {
      Sentry.init({
        dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
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
      const capture = () =>
        Sentry.captureEvent(
          telemetryEvent("client_exception", crypto.randomUUID()),
        );
      window.addEventListener("error", capture);
      window.addEventListener("unhandledrejection", capture);
    })
    .catch(() => {});
}

"use client";
import { useEffect, useState } from "react";
import { apiRequest, useWorkspace } from "@/lib/workspace-store";
import { errorMessage } from "./feedback";
import Link from "./workspace-link";
type Settings = {
  inApp: boolean;
  events: { id: string; run_id: string; kind: string; created_at: string }[];
};
export function NotificationSettings() {
  const { isLive } = useWorkspace();
  const [settings, setSettings] = useState<Settings | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!isLive) return;
    let active = true;
    apiRequest("/api/notifications")
      .then((data) => {
        if (active) setSettings(data);
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [isLive, attempt]);
  async function save(value: boolean) {
    setBusy(true);
    setError(null);
    try {
      await apiRequest("/api/notifications", { inApp: value });
      setSettings((s) => (s ? { ...s, inApp: value } : s));
      setAttempt((n) => n + 1);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  if (!isLive) return null;
  return (
    <section>
      <h2>Notifications</h2>
      <p className="muted">
        In-app events for new and repeated failures, verified regressions and
        runner configuration problems. No email or GitHub Issue is sent
        automatically.
      </p>
      {settings && (
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={settings.inApp}
            disabled={busy}
            onChange={(e) => save(e.target.checked)}
          />
          Show recent workspace events
        </label>
      )}
      {!settings && !error && (
        <p role="status">Loading notification settings…</p>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}{" "}
          <button
            className="text-link"
            onClick={() => {
              setError(null);
              setAttempt((n) => n + 1);
            }}
          >
            Retry
          </button>
        </p>
      )}
      {settings?.inApp && (
        <ul className="notification-events">
          {settings.events.map((event) => (
            <li key={event.id}>
              <Link className="text-link" href={`/app/runs/${event.run_id}`}>
                {event.kind.replaceAll("_", " ")}
              </Link>{" "}
              <span className="muted small-text">
                {new Date(event.created_at).toLocaleString()}
              </span>
            </li>
          ))}
          {!settings.events.length && (
            <li className="muted">No events recorded yet.</li>
          )}
        </ul>
      )}
    </section>
  );
}

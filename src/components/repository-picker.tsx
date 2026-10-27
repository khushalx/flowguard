"use client";
import { useState } from "react";
import { GitFork, RefreshCw, Unplug } from "lucide-react";
import { apiRequest, useWorkspace } from "@/lib/workspace-store";
import { ConfirmDialog } from "./ui";

export const connectionLabels = {
  connected: "Connected",
  removed: "Installation removed",
  access_required: "Access required",
  sync_failed: "Sync failed",
};
export function GitHubConnection({
  returnTo = "/app/connections",
}: {
  returnTo?: string;
}) {
  const { installations, githubAvailable, refresh } = useWorkspace();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disconnect, setDisconnect] = useState<string | null>(null);
  async function action(
    type: "connect" | "refresh" | "disconnect",
    id?: string,
  ) {
    setError(null);
    setPending(id ?? "connect");
    try {
      if (type === "connect")
        window.dispatchEvent(new Event("flowguard:save-project-draft"));
      const result = await apiRequest("/api/github", {
        action: type,
        id,
        returnTo,
      });
      if (type === "connect") {
        window.location.assign(result.url);
        return;
      }
      await refresh();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "GitHub connection failed. Try again.",
      );
    } finally {
      setPending(null);
    }
  }
  return (
    <div className="github-connection">
      <div className="integration-placeholder">
        <GitFork size={23} />
        <div>
          <h3>GitHub App</h3>
          <p>
            {installations.length
              ? "Repository access is separate from sign-in."
              : "Connect your personal GitHub account’s repositories."}
          </p>
        </div>
        {!installations.length && (
          <span className="neutral-tag">Not connected</span>
        )}
      </div>
      {installations.map((installation) => (
        <div key={installation.id} className="connection-row">
          <div>
            <strong>{installation.account}</strong>
            <span>
              {connectionLabels[installation.status]}
              {installation.needsSync ? " · Repository access changed" : ""}
            </span>
          </div>
          <div className="row-actions">
            {["connected", "sync_failed"].includes(installation.status) && (
              <>
                <button
                  type="button"
                  className="button secondary"
                  disabled={!!pending}
                  onClick={() => action("refresh", installation.id)}
                >
                  <RefreshCw size={14} />
                  {pending === installation.id ? "Syncing…" : "Refresh"}
                </button>
                <button
                  type="button"
                  className="icon-button"
                  disabled={!!pending}
                  aria-label={`Disconnect ${installation.account}`}
                  onClick={() => setDisconnect(installation.id)}
                >
                  <Unplug size={16} />
                </button>
              </>
            )}
          </div>
        </div>
      ))}
      <button
        type="button"
        className="button secondary"
        disabled={!githubAvailable || !!pending}
        onClick={() => action("connect")}
      >
        <GitFork size={15} />
        {pending === "connect"
          ? "Connecting…"
          : installations.length
            ? "Reconnect GitHub"
            : "Connect GitHub"}
      </button>
      {!githubAvailable && (
        <p className="field-hint">
          GitHub App configuration is missing on this instance. Follow SETUP.md
          to enable connections.
        </p>
      )}
      <p className="field-hint">
        Personal accounts only. Organization installations are not supported
        yet. Repository metadata access only; no code or workflow writes.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {disconnect && (
        <ConfirmDialog
          title="Disconnect GitHub?"
          description="This revokes this workspace’s connection and marks linked repositories as requiring access. It does not uninstall the app on GitHub or delete your projects. Reconnect to verify access again."
          confirmLabel="Disconnect"
          onClose={() => setDisconnect(null)}
          onConfirm={async () => {
            await action("disconnect", disconnect);
            setDisconnect(null);
          }}
        />
      )}
    </div>
  );
}
export function RepositoryPicker({
  value,
  onChange,
  returnTo = "/app/projects/new",
}: {
  value: string | null;
  onChange: (id: string | null, name: string) => void;
  returnTo?: string;
}) {
  const { repositories } = useWorkspace();
  return (
    <div className="repository-picker">
      <GitHubConnection returnTo={returnTo} />
      <div className="field">
        <label htmlFor="repository-picker">
          Repository <span className="optional">Optional</span>
        </label>
        <select
          id="repository-picker"
          value={value ?? ""}
          onChange={(e) => {
            const repo = repositories.find((r) => r.id === e.target.value);
            onChange(repo?.id ?? null, repo?.fullName ?? "");
          }}
        >
          <option value="">No linked repository</option>
          {repositories.map((repo) => (
            <option
              key={repo.id}
              value={repo.id}
              disabled={repo.status !== "connected"}
            >
              {repo.fullName}
              {repo.private ? " · Private" : ""}
              {repo.status !== "connected"
                ? ` · ${connectionLabels[repo.status]}`
                : ""}
            </option>
          ))}
        </select>
        <p className="field-hint">
          Access is verified again on save. Choose “No linked repository” to
          unlink. Refresh to fetch repository additions or removals.
        </p>
      </div>
    </div>
  );
}

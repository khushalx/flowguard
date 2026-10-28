"use client";
import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
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
  const {
    installations,
    repositories,
    githubAvailable,
    setConnections,
    discoverRepositories,
  } = useWorkspace();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disconnect, setDisconnect] = useState<string | null>(null);
  const [checking, setChecking] = useState(githubAvailable);
  const [notice, setNotice] = useState("");
  const managed = useRef<string | null>(null);
  const checkUpdated = useSearchParams().get("github") === "check";
  useEffect(() => {
    let active = true;
    discoverRepositories(checkUpdated)
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error
              ? e.message
              : "Could not check repository access. Retry below.",
          );
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [discoverRepositories, checkUpdated]);
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
      if (type === "connect" && result.url) {
        window.location.assign(result.url);
        return;
      }
      setConnections(result);
      setNotice(
        type === "disconnect"
          ? "Repository connection disconnected."
          : result.repositories.some(
                (r: { status: string }) => r.status === "connected",
              )
            ? "Repository access verified. Select a repository below."
            : "Installation verified, but no repositories are accessible. Manage repository access, then refresh.",
      );
      return true;
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "GitHub connection failed. Try again.",
      );
      try {
        setConnections(await apiRequest("/api/github"));
      } catch {
        setError(
          (previous) =>
            `${previous} Reload this page to check the latest connection state.`,
        );
      }
      return false;
    } finally {
      setPending(null);
    }
  }
  useEffect(() => {
    const refreshManaged = () => {
      const id = managed.current;
      if (!id) return;
      managed.current = null;
      void action("refresh", id);
    };
    window.addEventListener("focus", refreshManaged);
    return () => window.removeEventListener("focus", refreshManaged);
  });
  return (
    <div className="github-connection" aria-busy={checking || !!pending}>
      <div className="integration-placeholder">
        <GitFork size={23} />
        <div>
          <h3>GitHub App</h3>
          <p>
            {installations.length
              ? "Repository access is separate from sign-in."
              : "Sign-in identifies you. Connect repositories to grant read-only repository access."}
          </p>
        </div>
        {!installations.length && (
          <span className="neutral-tag">
            {checking ? "Checking access…" : "Not connected"}
          </span>
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
            <a
              className="text-link"
              href={installation.managementUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => {
                managed.current = installation.id;
                window.dispatchEvent(new Event("flowguard:save-project-draft"));
              }}
            >
              Manage repository access
            </a>
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
      {!installations.some((i) => i.status === "connected") && (
        <button
          type="button"
          className="button secondary"
          disabled={!githubAvailable || !!pending || checking}
          onClick={() => action("connect")}
        >
          <GitFork size={15} />
          {pending === "connect"
            ? "Connecting…"
            : installations.length
              ? "Reconnect repositories"
              : "Connect repositories"}
        </button>
      )}
      {checking && (
        <p className="field-hint" role="status">
          Checking existing GitHub App access…
        </p>
      )}
      {notice && (
        <p className="field-hint" role="status">
          {notice}
        </p>
      )}
      {!checking &&
        installations.some((i) => i.status === "connected") &&
        !repositories.some((r) => r.status === "connected") && (
          <p className="field-hint">
            No accessible repositories. Manage repository access and select at
            least one repository, or continue unlinked.
          </p>
        )}
      {!githubAvailable && (
        <p className="field-hint">
          GitHub App configuration is missing or invalid on this instance.
          Follow SETUP.md to enable connections.
        </p>
      )}
      <p className="field-hint">
        Personal accounts only. Organization installations are not supported
        yet. Repository metadata access only; no code or workflow writes.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}{" "}
          {githubAvailable && (
            <button
              type="button"
              className="text-link"
              disabled={checking || !!pending}
              onClick={async () => {
                setChecking(true);
                setError(null);
                try {
                  await discoverRepositories(true);
                } catch (e) {
                  setError(
                    e instanceof Error
                      ? e.message
                      : "Repository access check failed. Retry shortly.",
                  );
                } finally {
                  setChecking(false);
                }
              }}
            >
              Retry access check
            </button>
          )}
        </p>
      )}
      {disconnect && (
        <ConfirmDialog
          title="Disconnect GitHub?"
          description="This revokes this workspace’s connection and marks linked repositories as requiring access. It does not uninstall the app on GitHub or delete your projects. Reconnect to verify access again."
          confirmLabel="Disconnect"
          onClose={() => setDisconnect(null)}
          onConfirm={async () => {
            if (await action("disconnect", disconnect)) setDisconnect(null);
            else
              throw new Error("Disconnect could not be confirmed. Try again.");
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
  const [search, setSearch] = useState("");
  const visible = repositories.filter(
    (r) =>
      r.fullName.toLowerCase().includes(search.trim().toLowerCase()) ||
      r.id === value,
  );
  return (
    <div className="repository-picker">
      <GitHubConnection returnTo={returnTo} />
      {!!repositories.length && (
        <div className="field">
          <label htmlFor="repository-search">Search repositories</label>
          <input
            id="repository-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by owner or name"
          />
          {search &&
            !repositories.some((r) =>
              r.fullName.toLowerCase().includes(search.trim().toLowerCase()),
            ) && (
              <p className="field-hint" role="status">
                No matching repositories. Clear your search or manage repository
                access.
              </p>
            )}
        </div>
      )}
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
          {visible.map((repo) => (
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

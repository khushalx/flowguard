"use client";
import { PageHeader } from "./ui";
import { GitHubConnection } from "./repository-picker";
import { NotificationSettings } from "./notification-settings";
import { LocalImport } from "./local-import";
export function Connections({ message }: { message?: string }) {
  return (
    <>
      <PageHeader
        title="Connections"
        description="Manage repository access and bring in your local projects."
      />
      {message && (
        <p className="form-error" role="alert">
          {message}
        </p>
      )}
      <div className="connections-layout">
        <section>
          <h2>Repository access</h2>
          <GitHubConnection />
        </section>
        <section>
          <h2>Local projects</h2>
          <p className="muted">
            Import your previous browser workspace explicitly. Your demo data
            stays separate.
          </p>
          <LocalImport />
        </section>
        <NotificationSettings />
      </div>
    </>
  );
}

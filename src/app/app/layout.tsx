import { AppShell } from "@/components/app-shell";
import { LiveWorkspaceProvider } from "@/lib/workspace-store";
import { requireWorkspace } from "@/lib/server/auth";
import { readWorkspace } from "@/lib/server/workspace";
import { githubConfigured } from "@/lib/server/github";
import { AppError } from "@/lib/server/http";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { safeReturnTo } from "@/lib/env";
import Link from "next/link";
export const dynamic = "force-dynamic";
export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let initial;
  try {
    initial = await readWorkspace(await requireWorkspace());
  } catch (error) {
    if (error instanceof AppError && error.status === 401)
      redirect(
        `/login?error=session_expired&next=${encodeURIComponent(safeReturnTo((await headers()).get("x-flowguard-path")))}`,
      );
    return (
      <main className="auth-page">
        <div className="auth-content">
          <h1>Workspace unavailable</h1>
          <p role="alert">
            {error instanceof AppError
              ? error.message
              : "Your workspace could not be loaded. Check the Supabase configuration and migrations in SETUP.md."}
          </p>
          <Link className="button primary" href="/app">
            Try again
          </Link>
          <form action="/auth/logout" method="post">
            <button className="button secondary">Sign out</button>
          </form>
          <Link className="text-link" href="/demo">
            Open the local demo
          </Link>
        </div>
      </main>
    );
  }
  const current = new URL(
    (await headers()).get("x-flowguard-path") || "/app",
    "http://internal",
  );
  const notice =
    current.searchParams.get("github") === "error" &&
    current.pathname !== "/app/connections"
      ? current.searchParams.get("message")?.slice(0, 400) ||
        "GitHub connection failed. Start again."
      : current.searchParams.get("error") === "logout_failed"
        ? "Sign-out could not be completed. Try again."
        : undefined;
  return (
    <LiveWorkspaceProvider
      initial={initial}
      githubAvailable={githubConfigured()}
    >
      <AppShell notice={notice}>{children}</AppShell>
    </LiveWorkspaceProvider>
  );
}

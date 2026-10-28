import { createPrivateKey } from "node:crypto";
import { App, Octokit } from "octokit";
import { backendFetch } from "./transport";

export const boundedFetch = backendFetch("github");
export const GitHubClient = Octokit.defaults({
  retry: { enabled: false },
  throttle: { enabled: false },
  request: { fetch: boundedFetch },
});
export function githubConfigurationIssue(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const missing = [
    "GITHUB_APP_ID",
    "GITHUB_APP_SLUG",
    "GITHUB_APP_PRIVATE_KEY",
    "SUPABASE_SECRET_KEY",
  ].filter((name) => !env[name]);
  if (missing.length)
    return `Repository connection requires ${missing.join(", ")}.`;
  if (
    !/^\d+$/.test(env.GITHUB_APP_ID!) ||
    !/^[a-zA-Z0-9-]+$/.test(env.GITHUB_APP_SLUG!)
  )
    return "Check GITHUB_APP_ID and GITHUB_APP_SLUG in the server configuration.";
  try {
    if (
      createPrivateKey(env.GITHUB_APP_PRIVATE_KEY!.replace(/\\n/g, "\n"))
        .asymmetricKeyType !== "rsa"
    )
      return "GITHUB_APP_PRIVATE_KEY must be the GitHub App RSA private key in PEM format.";
  } catch {
    return "GITHUB_APP_PRIVATE_KEY is not a valid PEM private key. Download a GitHub App private key and configure it on the server.";
  }
  return null;
}
export function createGitHubApp() {
  return new App({
    appId: process.env.GITHUB_APP_ID!,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY!.replace(/\\n/g, "\n"),
    Octokit: GitHubClient,
  });
}
export function githubFailure(error: unknown) {
  const e = error as {
    status?: number;
    response?: { headers?: Record<string, string> };
  };
  const status = Number(e?.status) || 0;
  const headers = e?.response?.headers;
  const limited =
    status === 429 ||
    (status === 403 &&
      (headers?.["x-ratelimit-remaining"] === "0" ||
        !!headers?.["retry-after"]));
  return {
    status,
    state: limited
      ? "sync_failed"
      : status === 404
        ? "removed"
        : status === 401 || status === 403
          ? "access_required"
          : "sync_failed",
    message: limited
      ? "GitHub is rate limiting requests. Wait a few minutes, then refresh repositories. Your project draft is preserved."
      : status === 404
        ? "The installation is unavailable or removed. Connect repositories to verify access again."
        : status === 401 || status === 403
          ? "GitHub repository access is unavailable. Manage repository access, then refresh."
          : "GitHub could not be reached. Your project draft is preserved. Retry repository access.",
  } as const;
}

// Resolve the immutable provider ID, not the editable Supabase profile username.
export async function findPersonalInstallation(
  app: Pick<Octokit, "request">,
  githubId: number,
  publicClient: Pick<Octokit, "request"> = new GitHubClient(),
) {
  const { data: account } = await publicClient.request(
    "GET /user/{account_id}",
    { account_id: githubId },
  );
  if (account.id !== githubId || account.type !== "User")
    throw new Error("Verified personal GitHub account required");
  try {
    const { data } = await app.request("GET /users/{username}/installation", {
      username: account.login,
    });
    return data;
  } catch (error) {
    if ((error as { status?: number }).status === 404) return null;
    throw error;
  }
}

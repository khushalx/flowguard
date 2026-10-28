import "server-only";
import { requireWorkspace } from "./auth";
import { runReport } from "./reports";
import { projectExecution } from "./execution";
import { createGitHubApp, GitHubClient } from "./github-client";
import { adminClient } from "../supabase/admin";
import { digest } from "./report-snapshot";
import { AppError, dbCheck } from "./http";
export async function issueAccess(
  context: Awaited<ReturnType<typeof requireWorkspace>>,
  id: string,
  create = false,
  reviewedHash?: string,
) {
  const report = await runReport(context, id);
  if (!report.prompt)
    throw new AppError(
      "Only unsuccessful completed runs can be reported as issues.",
      409,
    );
  const linked = await projectExecution(context, report.run.projectId);
  if (
    report.run.snapshot?.repository &&
    report.run.snapshot.repository !== linked.repository.full_name
  )
    throw new AppError(
      "The repository changed since this run. Use the manual issue body.",
      409,
    );
  const app = createGitHubApp();
  const installationId = Number(linked.installation.github_installation_id);
  const { data: installation } = await app.octokit.request(
    "GET /app/installations/{installation_id}",
    { installation_id: installationId },
  );
  if (installation.permissions.issues !== "write")
    return {
      available: false,
      message:
        "The GitHub App does not have explicit Issues: write permission. Copy the issue body instead. No permission change was requested.",
    };
  const body = report.prompt,
    bodyHash = digest(body);
  if (!create)
    return {
      available: true,
      body,
      bodyHash,
      message:
        "Explicit Issues: write permission verified. Review the issue body before creating it.",
    };
  if (reviewedHash !== bodyHash)
    throw new AppError(
      "Issue evidence changed. Check permission again and review the current body before creating it.",
      409,
    );
  const reserved = await adminClient()
    .from("run_issue_links")
    .insert({ run_id: id, workspace_id: context.workspaceId });
  if (reserved.error?.code === "23505") {
    const existing = await context.db
      .from("run_issue_links")
      .select("issue_url")
      .eq("run_id", id)
      .eq("workspace_id", context.workspaceId)
      .single();
    dbCheck(existing.error);
    if (existing.data?.issue_url)
      return { available: true, url: existing.data.issue_url };
    throw new AppError(
      "An issue request was already attempted. Check the repository before creating another issue manually; no duplicate was sent.",
      409,
    );
  }
  dbCheck(reserved.error);
  try {
    const { data: grant } = await app.octokit.request(
      "POST /app/installations/{installation_id}/access_tokens",
      {
        installation_id: installationId,
        repository_ids: [Number(linked.repository.github_repository_id)],
        permissions: { metadata: "read", issues: "write" },
      },
    );
    const github = new GitHubClient({ auth: grant.token });
    const { data: issue } = await github.request(
      "POST /repos/{owner}/{repo}/issues",
      {
        owner: linked.repository.owner_login,
        repo: linked.repository.name,
        title: `FlowGuard: ${report.run.journeyName}`.slice(0, 200),
        body,
      },
    );
    const saved = await adminClient()
      .from("run_issue_links")
      .update({ issue_url: issue.html_url })
      .eq("run_id", id)
      .eq("workspace_id", context.workspaceId);
    dbCheck(saved.error);
    return { available: true, url: issue.html_url };
  } catch {
    throw new AppError(
      "GitHub issue creation could not be confirmed. Check the repository; retry is locked to avoid duplicates. The manual issue body remains available.",
      502,
    );
  }
}

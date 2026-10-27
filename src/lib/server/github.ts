import "server-only";
import { App } from "octokit";
import { z } from "zod";
import { adminClient } from "../supabase/admin";
import { authorizedPersonalInstallation } from "./github-security";
import { AppError, dbCheck } from "./http";
import type { requireWorkspace } from "./auth";
import { fetchInstallationRepositories } from "./github-repositories";

type Context = Awaited<ReturnType<typeof requireWorkspace>>;
export function githubConfigured() {
  return !!(
    process.env.GITHUB_APP_ID &&
    process.env.GITHUB_APP_SLUG &&
    process.env.GITHUB_APP_PRIVATE_KEY &&
    process.env.SUPABASE_SECRET_KEY
  );
}
function githubApp() {
  const env = z
    .object({
      appId: z.string().regex(/^\d+$/),
      privateKey: z.string().min(100),
    })
    .safeParse({
      appId: process.env.GITHUB_APP_ID,
      privateKey: process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    });
  if (!env.success)
    throw new AppError("GitHub App is not configured. Follow SETUP.md.", 503);
  return new App(env.data);
}
async function githubIdentity(context: Context) {
  // This column is populated from auth.identities by bootstrap, and its
  // authenticated UPDATE privilege is revoked. Never use user_metadata IDs.
  const result = await context.db
    .from("profiles")
    .select("github_user_id")
    .eq("id", context.user.id)
    .single();
  dbCheck(result.error);
  const id = z.coerce
    .number()
    .int()
    .positive()
    .safe()
    .parse(result.data?.github_user_id);
  return id;
}
export async function connectInstallation(
  context: Context,
  installationId: number,
) {
  const githubId = await githubIdentity(context);
  const app = githubApp();
  const { data: installation } = await app.octokit.request(
    "GET /app/installations/{installation_id}",
    { installation_id: installationId },
  );
  // Personal account ownership is verified using the immutable provider ID,
  // not a username, callback parameter, or organization membership assumption.
  if (!authorizedPersonalInstallation(installation, githubId))
    throw new AppError(
      installation.account &&
        "type" in installation.account &&
        installation.account.type === "Organization"
        ? "Organization installations are not supported yet. Install on your personal GitHub account."
        : "This installation is not owned by your verified GitHub account, or access is suspended.",
      403,
    );
  const admin = adminClient();
  const existing = await admin
    .from("github_installations")
    .select("id,workspace_id")
    .eq("github_installation_id", installationId)
    .maybeSingle();
  dbCheck(existing.error);
  if (existing.data && existing.data.workspace_id !== context.workspaceId)
    throw new AppError(
      "This installation is already connected to another workspace.",
      403,
    );
  // Never upsert workspace_id: a concurrent callback cannot transfer a claim.
  const values = {
    github_installation_id: installationId,
    github_account_id: githubId,
    github_account_login: z
      .object({ login: z.string().min(1) })
      .parse(installation.account).login,
    account_type: "User",
    installation_status: "connected",
  };
  const result = existing.data
    ? await admin
        .from("github_installations")
        .update(values)
        .eq("id", existing.data.id)
        .eq("workspace_id", context.workspaceId)
        .select("id")
        .single()
    : await admin
        .from("github_installations")
        .insert({ ...values, workspace_id: context.workspaceId })
        .select("id")
        .single();
  dbCheck(result.error);
  await syncRepositories(context, result.data!.id, installationId);
  return result.data!.id as string;
}
export async function syncRepositories(
  context: Context,
  id: string,
  knownInstallation?: number,
) {
  const found = await context.db
    .from("github_installations")
    .select("*")
    .eq("id", id)
    .eq("workspace_id", context.workspaceId)
    .single();
  dbCheck(found.error);
  const installationId =
    knownInstallation ?? Number(found.data!.github_installation_id);
  const app = githubApp();
  const admin = adminClient();
  try {
    const { data: installation } = await app.octokit.request(
      "GET /app/installations/{installation_id}",
      { installation_id: installationId },
    );
    if (
      !authorizedPersonalInstallation(
        installation,
        await githubIdentity(context),
      )
    )
      throw new AppError(
        "Installation access required. Reconnect your personal GitHub account.",
        403,
      );
    const repos = await fetchInstallationRepositories(
      app.octokit,
      installationId,
    );
    const ready = await admin
      .from("github_installations")
      .update({ installation_status: "connected" })
      .eq("id", id)
      .in("installation_status", ["connected", "sync_failed"])
      .select("id")
      .maybeSingle();
    dbCheck(ready.error);
    if (!ready.data)
      throw new AppError(
        "Reconnect GitHub before refreshing this installation.",
        403,
      );
    // The SDK handles ephemeral installation tokens entirely server-side.
    const result = await admin.rpc("sync_installation_repositories", {
      iid: id,
      repos,
    });
    dbCheck(result.error);
  } catch (error) {
    const status =
      error && typeof error === "object" && "status" in error
        ? Number(error.status)
        : 0;
    const state =
      status === 404
        ? "removed"
        : status === 401 || status === 403
          ? "access_required"
          : "sync_failed";
    await admin
      .from("github_installations")
      .update({ installation_status: state })
      .eq("id", id)
      .eq("workspace_id", context.workspaceId);
    await admin
      .from("repositories")
      .update({ sync_status: state })
      .eq("github_installation_id", id)
      .eq("workspace_id", context.workspaceId);
    throw new AppError(
      state === "removed"
        ? "Installation removed. Reconnect GitHub to restore access."
        : state === "access_required"
          ? "Access required. Reconnect GitHub and approve repository access."
          : "Repository sync failed. Your project configuration is preserved; try again.",
      status === 404 ? 409 : 503,
    );
  }
}
export async function verifyRepositoryAccess(
  context: Context,
  repositoryId: string,
) {
  const result = await context.db
    .from("repositories")
    .select("github_installation_id,github_repository_id,owner_login,name")
    .eq("id", repositoryId)
    .eq("workspace_id", context.workspaceId)
    .maybeSingle();
  dbCheck(result.error);
  if (!result.data)
    throw new AppError("Repository is not accessible in this workspace.", 403);
  await syncRepositories(context, result.data.github_installation_id);
  const current = await context.db
    .from("repositories")
    .select("sync_status")
    .eq("id", repositoryId)
    .eq("workspace_id", context.workspaceId)
    .single();
  dbCheck(current.error);
  if (current.data?.sync_status !== "connected")
    throw new AppError(
      "Repository access was removed. Select an accessible repository or leave the project unlinked.",
      403,
    );
}

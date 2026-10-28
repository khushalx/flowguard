import "server-only";
import {
  createGitHubApp,
  githubConfigurationIssue,
  githubFailure,
  findPersonalInstallation,
} from "./github-client";
import { z } from "zod";
import { adminClient } from "../supabase/admin";
import { authorizedPersonalInstallation } from "./github-security";
import { AppError, dbCheck } from "./http";
import type { requireWorkspace } from "./auth";
import { fetchInstallationRepositories } from "./github-repositories";

type Context = Awaited<ReturnType<typeof requireWorkspace>>;
export function githubConfigured() {
  return githubConfigurationIssue() === null;
}
function githubApp() {
  const issue = githubConfigurationIssue();
  if (issue) throw new AppError(issue, 503);
  return createGitHubApp();
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
    disconnected_at: null,
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
  if (result.error?.code === "23505" && !existing.data) {
    // A simultaneous discovery/callback may win the unique claim; re-check it.
    const claimed = await admin
      .from("github_installations")
      .select("id,workspace_id")
      .eq("github_installation_id", installationId)
      .single();
    dbCheck(claimed.error);
    if (claimed.data?.workspace_id !== context.workspaceId)
      throw new AppError(
        "This installation is already connected to another workspace.",
        403,
      );
    await syncRepositories(context, claimed.data.id);
    return claimed.data.id as string;
  }
  dbCheck(result.error);
  await syncRepositories(context, result.data!.id, { installation, githubId });
  return result.data!.id as string;
}
export async function syncRepositories(
  context: Context,
  id: string,
  verified?: {
    installation: { account: unknown; suspended_at?: string | null };
    githubId: number;
  },
) {
  const found = await context.db
    .from("github_installations")
    .select("*")
    .eq("id", id)
    .eq("workspace_id", context.workspaceId)
    .single();
  dbCheck(found.error);
  const installationId = Number(found.data!.github_installation_id);
  const app = githubApp();
  const admin = adminClient();
  let version = found.data!.updated_at;
  try {
    const installation =
      verified?.installation ??
      (
        await app.octokit.request("GET /app/installations/{installation_id}", {
          installation_id: installationId,
        })
      ).data;
    if (
      !authorizedPersonalInstallation(
        installation,
        verified?.githubId ?? (await githubIdentity(context)),
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
      .eq("updated_at", version)
      .select("id,updated_at")
      .maybeSingle();
    dbCheck(ready.error);
    if (!ready.data)
      throw new AppError(
        "Repository access changed while syncing. Refresh repositories to check the latest access.",
        409,
      );
    version = ready.data.updated_at;
    // The SDK handles ephemeral installation tokens entirely server-side.
    const result = await admin.rpc("sync_installation_repositories", {
      iid: id,
      repos,
    });
    dbCheck(result.error);
  } catch (error) {
    if (error instanceof AppError && error.status === 409) throw error;
    const failure = githubFailure(error);
    console.error("FlowGuard GitHub sync failed", {
      status: failure.status,
      state: failure.state,
    });
    // Never overwrite a removal/permission webhook that arrived during this sync.
    const changed = await admin
      .from("github_installations")
      .update({ installation_status: failure.state, last_synced_at: null })
      .eq("id", id)
      .eq("workspace_id", context.workspaceId)
      .eq("updated_at", version)
      .select("id")
      .maybeSingle();
    dbCheck(changed.error);
    if (changed.data) {
      const repos = await admin
        .from("repositories")
        .update({ sync_status: failure.state })
        .eq("github_installation_id", id)
        .eq("workspace_id", context.workspaceId);
      dbCheck(repos.error);
    }
    throw new AppError(failure.message, failure.status === 404 ? 409 : 503);
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

export async function discoverInstallation(
  context: Context,
  force = false,
  refresh = false,
) {
  const known = await context.db
    .from("github_installations")
    .select("id,installation_status,needs_sync,last_synced_at,disconnected_at")
    .eq("workspace_id", context.workspaceId)
    .maybeSingle();
  dbCheck(known.error);
  if (known.data?.disconnected_at && !force) return false;
  if (
    !force &&
    !refresh &&
    known.data?.installation_status === "connected" &&
    !known.data.needs_sync &&
    Date.now() - Date.parse(known.data.last_synced_at ?? "") < 60_000
  )
    return true;
  try {
    if (
      known.data?.installation_status === "connected" ||
      known.data?.installation_status === "sync_failed"
    ) {
      await syncRepositories(context, known.data.id);
      return true;
    }
    const installation = await findPersonalInstallation(
      githubApp().octokit,
      await githubIdentity(context),
    );
    if (!installation) return false;
    await connectInstallation(context, installation.id);
    return true;
  } catch (error) {
    if (error instanceof AppError) throw error;
    const failure = githubFailure(error);
    console.error("FlowGuard GitHub discovery failed", {
      status: failure.status,
    });
    throw new AppError(failure.message, 503);
  }
}

import "server-only";
import { serverClient } from "../supabase/server";
import { AppError, dbCheck } from "./http";

export async function requireIdentity() {
  const db = await serverClient();
  const { data, error } = await db.auth.getUser();
  if (error || !data.user || data.user.is_anonymous)
    throw new AppError("Your session has expired. Sign in again.", 401);
  return { db, user: data.user };
}
export async function requireWorkspace(edit = false) {
  const { db, user } = await requireIdentity();
  const result = await db.rpc("bootstrap_workspace");
  dbCheck(result.error);
  const workspaceId = result.data as string;
  if (!workspaceId)
    throw new AppError("Your workspace could not be initialized.", 503);
  const membership = await db
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .single();
  dbCheck(membership.error);
  if (
    !membership.data ||
    (edit && !["owner", "admin"].includes(membership.data.role))
  )
    throw new AppError("Workspace access required.", 403);
  return { db, user, workspaceId, role: membership.data.role as string };
}

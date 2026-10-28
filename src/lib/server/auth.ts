import "server-only";
import { serverClient } from "../supabase/server";
import { platformError } from "./monitoring";
import { AppError, dbCheck } from "./http";
import { cache } from "react";
import { z } from "zod";

const contextSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  role: z.string(),
  username: z.string().nullable(),
  full_name: z.string().nullable(),
  avatar_url: z.string().nullable(),
});

export const requireIdentity = cache(async () => {
  const db = await serverClient();
  const { data, error } = await db.auth.getUser();
  if (
    error &&
    (error.name === "AuthRetryableFetchError" || (error.status ?? 0) >= 500)
  ) {
    platformError("auth_failure", 503);
    throw new AppError(
      "Sign-in verification is temporarily unavailable. Try again shortly.",
      503,
    );
  }
  if (error || !data.user || data.user.is_anonymous)
    throw new AppError("Your session has expired. Sign in again.", 401);
  return { db, user: data.user };
});
export async function requireWorkspace(edit = false) {
  const { db, user } = await requireIdentity();
  let result = await db.rpc("workspace_context").maybeSingle();
  dbCheck(result.error);
  if (!result.data) {
    // Bootstrap only a first sign-in or missing membership, never every read.
    const created = await db.rpc("bootstrap_workspace");
    dbCheck(created.error);
    result = await db.rpc("workspace_context").maybeSingle();
    dbCheck(result.error);
  }
  const member = result.data ? contextSchema.parse(result.data) : null;
  if (!member || (edit && !["owner", "admin"].includes(member.role)))
    throw new AppError("Workspace access required.", 403);
  return {
    db,
    user,
    workspaceId: member.id as string,
    role: member.role as string,
    member,
  };
}

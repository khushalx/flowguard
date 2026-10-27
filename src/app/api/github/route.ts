import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { requireWorkspace } from "@/lib/server/auth";
import {
  apiError,
  AppError,
  dbCheck,
  jsonBody,
  sameOrigin,
} from "@/lib/server/http";
import { githubConfigured, syncRepositories } from "@/lib/server/github";
import { adminClient } from "@/lib/supabase/admin";
import { hashState } from "@/lib/server/github-security";
import { safeReturnTo } from "@/lib/env";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("connect"), returnTo: z.string().optional() }),
  z.object({ action: z.literal("refresh"), id: z.string().uuid() }),
  z.object({ action: z.literal("disconnect"), id: z.string().uuid() }),
]);
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const body = schema.parse(await jsonBody(request));
    const context = await requireWorkspace(true);
    if (!githubConfigured())
      throw new AppError(
        "GitHub App is not configured on this instance. Follow SETUP.md.",
        503,
      );
    const admin = adminClient();
    if (body.action === "connect") {
      const state = randomBytes(32).toString("hex");
      const result = await admin.rpc("issue_installation_state", {
        token_hash: hashState(state),
        user_id: context.user.id,
        workspace_id: context.workspaceId,
        return_to: safeReturnTo(body.returnTo),
      });
      dbCheck(result.error);
      (await cookies()).set("fg_install_state", state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 600,
        path: "/api/github",
      });
      const slug = z
        .string()
        .regex(/^[a-zA-Z0-9-]+$/)
        .parse(process.env.GITHUB_APP_SLUG);
      return Response.json({
        url: `https://github.com/apps/${slug}/installations/new?state=${state}`,
      });
    }
    const installation = await context.db
      .from("github_installations")
      .select("id")
      .eq("id", body.id)
      .eq("workspace_id", context.workspaceId)
      .maybeSingle();
    dbCheck(installation.error);
    if (!installation.data)
      throw new AppError("Installation not found in this workspace.", 404);
    if (body.action === "refresh") await syncRepositories(context, body.id);
    else {
      const result = await admin.rpc("disconnect_installation", {
        iid: body.id,
        wid: context.workspaceId,
      });
      dbCheck(result.error);
    }
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

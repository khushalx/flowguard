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
import { discoverInstallation, syncRepositories } from "@/lib/server/github";
import { githubConfigurationIssue } from "@/lib/server/github-client";
import { readConnections } from "@/lib/server/workspace";
import { adminClient } from "@/lib/supabase/admin";
import { hashState } from "@/lib/server/github-security";
import { safeReturnTo } from "@/lib/env";

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("connect"), returnTo: z.string().optional() }),
  z.object({ action: z.literal("discover"), refresh: z.boolean().optional() }),
  z.object({ action: z.literal("refresh"), id: z.string().uuid() }),
  z.object({ action: z.literal("disconnect"), id: z.string().uuid() }),
]);
export async function GET() {
  try {
    return Response.json(await readConnections(await requireWorkspace()), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const body = schema.parse(await jsonBody(request));
    const context = await requireWorkspace(true);
    const issue = githubConfigurationIssue();
    if (issue) throw new AppError(issue, 503);
    const admin = adminClient();
    if (body.action === "discover" || body.action === "connect") {
      const connected = await discoverInstallation(
        context,
        body.action === "connect",
        body.action === "discover" && body.refresh,
      );
      if (body.action === "discover" || connected)
        return Response.json(
          { connected, ...(await readConnections(context)) },
          { headers: { "Cache-Control": "private, no-store" } },
        );
    }
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
      .select("id,github_installation_id")
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
    return Response.json(await readConnections(context), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}

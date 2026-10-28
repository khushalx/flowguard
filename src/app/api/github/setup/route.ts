import { monitored } from "@/lib/server/monitoring";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireWorkspace } from "@/lib/server/auth";
import { connectInstallation } from "@/lib/server/github";
import { adminClient } from "@/lib/supabase/admin";
import { hashState, sameSecret } from "@/lib/server/github-security";
import { appOrigin, safeReturnTo } from "@/lib/env";
import { AppError, dbCheck, internalRedirect } from "@/lib/server/http";

async function GETHandler(request: Request) {
  const store = await cookies();
  const saved = store.get("fg_install_state")?.value;
  let destination = "/app/connections";
  try {
    const context = await requireWorkspace(true);
    const url = new URL(request.url);
    const state = url.searchParams.get("state");
    // GitHub may omit state on an installation-settings update. Do not claim
    // the supplied ID: navigate to a fresh, independently verified discovery.
    if (!state && url.searchParams.get("setup_action") === "update")
      return internalRedirect("/app/connections?github=check");
    if (!saved || !state || !sameSecret(saved, state))
      throw new AppError(
        "Installation state expired. Start the connection again.",
      );
    store.set("fg_install_state", "", {
      path: "/api/github",
      maxAge: 0,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    const result = await adminClient().rpc("consume_installation_state", {
      hash: hashState(state),
      uid: context.user.id,
    });
    dbCheck(result.error);
    const claim = result.data?.[0];
    if (!claim || claim.workspace_id !== context.workspaceId)
      throw new AppError("Installation state was already used or expired.");
    destination = safeReturnTo(claim.return_to);
    if (!url.searchParams.get("installation_id"))
      throw new AppError(
        "No repository access was granted. Connect repositories when you’re ready.",
      );
    const id = z.coerce
      .number()
      .int()
      .positive()
      .safe()
      .parse(url.searchParams.get("installation_id"));
    await connectInstallation(context, id);
    const target = new URL(destination, appOrigin());
    target.searchParams.set("github", "connected");
    return NextResponse.redirect(target, 303);
  } catch (error) {
    const target = new URL(destination, request.url);
    target.searchParams.set("github", "error");
    target.searchParams.set(
      "message",
      error instanceof AppError
        ? error.message
        : "GitHub connection failed. Check configuration and start again.",
    );
    return internalRedirect(target.pathname + target.search);
  }
}

export const GET = monitored(GETHandler);

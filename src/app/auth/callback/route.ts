import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { appOrigin, safeReturnTo } from "@/lib/env";
import { requireWorkspace } from "@/lib/server/auth";
import { internalRedirect } from "@/lib/server/http";

export async function GET(request: Request) {
  const store = await cookies();
  const next = safeReturnTo(store.get("fg_return_to")?.value);
  store.set("fg_return_to", "", {
    path: "/auth",
    maxAge: 0,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    if (!code || url.searchParams.has("error"))
      throw new Error("Authentication cancelled");
    const db = await serverClient();
    const flowId = url.searchParams.get("sb_flow_id");
    const { error } = await db.auth.exchangeCodeForSession(
      code,
      flowId ? { flowId } : undefined,
    );
    if (error) throw error;
    await requireWorkspace();
    return NextResponse.redirect(new URL(next, appOrigin()), 303);
  } catch {
    return internalRedirect("/login?error=callback_failed");
  }
}

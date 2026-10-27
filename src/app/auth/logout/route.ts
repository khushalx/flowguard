import { NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { sameOrigin } from "@/lib/server/http";
import { appOrigin } from "@/lib/env";

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const db = await serverClient();
    const { error } = await db.auth.signOut({ scope: "local" });
    if (error)
      return NextResponse.redirect(
        new URL("/app?error=logout_failed", appOrigin()),
        303,
      );
    return NextResponse.redirect(new URL("/login", appOrigin()), 303);
  } catch {
    return Response.json(
      { error: "Sign out failed. Reload and try again." },
      { status: 403 },
    );
  }
}

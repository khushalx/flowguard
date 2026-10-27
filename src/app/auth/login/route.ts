import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { appOrigin, safeReturnTo } from "@/lib/env";
import { sameOrigin, internalRedirect } from "@/lib/server/http";

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const form = await request.formData();
    const db = await serverClient();
    const origin = appOrigin();
    const { data, error } = await db.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: `${origin}/auth/callback`,
        scopes: "read:user user:email",
        skipBrowserRedirect: true,
      },
    });
    if (error || !data.url) throw new Error("OAuth unavailable");
    (await cookies()).set("fg_return_to", safeReturnTo(form.get("next")), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600,
      path: "/auth",
    });
    return NextResponse.redirect(data.url, 303);
  } catch {
    return internalRedirect("/login?error=login_unavailable");
  }
}

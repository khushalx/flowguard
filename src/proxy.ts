import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicConfig, safeReturnTo } from "@/lib/env";
import { backendFetch } from "@/lib/server/transport";

export async function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set(
    "x-flowguard-path",
    request.nextUrl.pathname + request.nextUrl.search,
  );
  let response = NextResponse.next({ request: { headers } });
  const config = publicConfig();
  let authenticated = false;
  if (config && request.nextUrl.pathname !== "/api/github/webhook") {
    const supabase = createServerClient(config.url, config.key, {
      global: { fetch: backendFetch("supabase") },
      cookieOptions: {
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        httpOnly: true,
      },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(values, cacheHeaders) {
          values.forEach(({ name, value }) => request.cookies.set(name, value));
          headers.set("cookie", request.cookies.toString());
          response = NextResponse.next({ request: { headers } });
          values.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          if (cacheHeaders)
            Object.entries(cacheHeaders).forEach(([name, value]) =>
              response.headers.set(name, value),
            );
        },
      },
    });
    const { data, error } = await supabase.auth.getClaims();
    authenticated = !error && !!data?.claims.sub;
  }
  if (request.nextUrl.pathname.startsWith("/app") && !authenticated) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set(
      "next",
      safeReturnTo(request.nextUrl.pathname + request.nextUrl.search),
    );
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    redirect.headers.set("Cache-Control", "private, no-store");
    return redirect;
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = {
  matcher: ["/app/:path*", "/login", "/auth/:path*", "/api/:path*"],
};

import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { LoginForm } from "@/components/login-form";
import { BrandMark } from "@/components/brand";
import { authConfigurationIssues, safeReturnTo } from "@/lib/env";
import { serverClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

const errors: Record<string, string> = {
  callback_failed:
    "Sign-in could not be completed. The link may have expired or been cancelled. Try again. If this continues, check your provider and database setup.",
  login_unavailable:
    "GitHub sign-in is unavailable. Check the Supabase provider settings and application URL, then try again.",
  session_expired: "Your session has expired. Sign in to continue.",
};
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const query = await searchParams;
  const next = safeReturnTo(query.next);
  const configurationIssues = authConfigurationIssues();
  const configured = configurationIssues.length === 0;
  if (configured && !query.error) {
    const db = await serverClient();
    const { data } = await db.auth.getUser();
    if (data.user && !data.user.is_anonymous) redirect(next);
  }
  return (
    <main className="auth-page">
      <Link href="/" className="brand">
        <BrandMark />
        <span>FlowGuard</span>
      </Link>
      <div className="auth-content">
        <span className="section-overline">Your workspace</span>
        <h1>Sign in to FlowGuard</h1>
        <p>Keep your projects, repositories, and journeys in one place.</p>
        {query.error && (
          <p className="form-error" role="alert">
            {errors[query.error] ??
              "Sign-in could not be completed. Try again."}
          </p>
        )}
        {!configured && (
          <div className="info-panel">
            <div>
              <p>
                Authentication isn’t configured on this instance. Follow{" "}
                <span className="mono">SETUP.md</span> to connect Supabase and
                GitHub.
              </p>
              {configurationIssues.map((issue) => (
                <p key={issue} className="field-hint">
                  {issue}
                </p>
              ))}
            </div>
          </div>
        )}
        <LoginForm configured={configured} next={next} />
        <p className="field-hint">
          Signing in identifies your account. Repository access requires a
          separate GitHub App connection.
        </p>
        <Link href="/demo" className="text-link">
          Explore the local demo
          <ArrowUpRight size={15} />
        </Link>
      </div>
      <Link href="/" className="text-link">
        <ArrowLeft size={14} />
        Back to FlowGuard
      </Link>
    </main>
  );
}

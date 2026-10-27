"use client";
import { useState } from "react";
import { GitFork, LoaderCircle } from "lucide-react";
export function LoginForm({
  configured,
  next,
}: {
  configured: boolean;
  next: string;
}) {
  const [pending, setPending] = useState(false);
  return (
    <form action="/auth/login" method="post" onSubmit={() => setPending(true)}>
      <input type="hidden" name="next" value={next} />
      <button className="button primary" disabled={!configured || pending}>
        {pending ? (
          <LoaderCircle size={18} className="spin" />
        ) : (
          <GitFork size={18} />
        )}
        <span role={pending ? "status" : undefined}>
          {pending ? "Continuing to GitHub…" : "Continue with GitHub"}
        </span>
      </button>
    </form>
  );
}

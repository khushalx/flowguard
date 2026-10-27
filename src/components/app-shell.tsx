"use client";
import Link from "./workspace-link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  Database,
  FolderOpen,
  HardDrive,
  Layers,
} from "lucide-react";
import { useWorkspace } from "@/lib/workspace-store";
import { BrandMark, ConfirmDialog, EmptyState } from "./ui";
import { errorMessage, useFeedback } from "./feedback";
export function AppShell({
  children,
  notice,
}: {
  children: ReactNode;
  notice?: string;
}) {
  const pathname = usePathname();
  const { data, error, actions, isLive, info, basePath, refresh } =
    useWorkspace();
  const notify = useFeedback();
  const [reset, setReset] = useState(false);
  const menuRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target)
      )
        menuRef.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  const mode = data?.mode;
  async function switchMode(next: "demo" | "local") {
    try {
      await actions.setMode(next);
      notify(
        next === "demo"
          ? "Demo workspace opened. Your local projects are preserved."
          : "Local workspace opened. Changes stay in this browser.",
      );
    } catch (e) {
      notify(errorMessage(e), "error");
    }
  }
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand" aria-label="FlowGuard home">
            <BrandMark />
            <span>FlowGuard</span>
          </Link>
          <span className="nav-divider" aria-hidden="true" />
          <nav className="primary-nav" aria-label="Primary navigation">
            {[
              ["/app", "Overview"],
              ["/app/projects", "Projects"],
              ["/app/runs", "Runs"],
            ].map(([href, label]) => (
              <Link
                key={href}
                href={href}
                aria-current={
                  (
                    href === "/app"
                      ? pathname === href.replace("/app", basePath)
                      : pathname.startsWith(href.replace("/app", basePath))
                  )
                    ? "page"
                    : undefined
                }
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className="workspace-control">
            <details
              ref={menuRef}
              className="workspace-menu"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  menuRef.current?.removeAttribute("open");
                  menuRef.current?.querySelector("summary")?.focus();
                }
              }}
            >
              <summary
                aria-label={isLive ? undefined : "Personal workspace menu"}
              >
                <span
                  className="workspace-mode"
                  aria-label={
                    mode === "demo"
                      ? "Demo data, no live tests"
                      : isLive
                        ? undefined
                        : "Local workspace"
                  }
                >
                  {mode === "demo" ? "Demo" : isLive ? "Cloud" : "Local"}
                </span>
                <span className="avatar" aria-hidden="true">
                  {info?.account.avatar ? (
                    <Image
                      src={info.account.avatar}
                      alt=""
                      width={28}
                      height={28}
                      unoptimized
                    />
                  ) : (
                    info?.account.name.charAt(0) || "P"
                  )}
                </span>
                <span className="workspace-name">
                  {info?.name ?? "Personal workspace"}
                </span>
                <ChevronDown size={14} />
              </summary>
              <div className="workspace-dropdown">
                <div className="menu-heading">
                  {isLive ? info?.account.name : "Workspace data"}
                  <span>
                    {isLive
                      ? info?.account.username
                        ? `@${info.account.username}`
                        : info?.account.email
                      : "Stored on this device"}
                  </span>
                  {isLive && info?.account.username && info?.account.email && (
                    <span>{info.account.email}</span>
                  )}
                </div>
                {isLive ? (
                  <>
                    <Link href="/app/connections" className="menu-link">
                      Connections & import
                    </Link>
                    <button
                      onClick={async () => {
                        try {
                          await refresh();
                          notify("Workspace refreshed.");
                        } catch (e) {
                          notify(errorMessage(e), "error");
                        }
                      }}
                    >
                      Refresh workspace
                    </button>
                    <Link href="/demo" className="menu-link">
                      Open the separate demo
                    </Link>
                    <form action="/auth/logout" method="post">
                      <button type="submit">Sign out</button>
                    </form>
                  </>
                ) : (
                  <>
                    <button
                      disabled={!data}
                      onClick={(e) => {
                        switchMode("demo");
                        e.currentTarget
                          .closest("details")
                          ?.removeAttribute("open");
                      }}
                    >
                      <Layers size={16} />
                      <span>
                        Demo workspace
                        <small>Sample projects and evidence</small>
                      </span>
                      {mode === "demo" && <Check size={16} />}
                    </button>
                    <button
                      disabled={!data}
                      onClick={(e) => {
                        switchMode("local");
                        e.currentTarget
                          .closest("details")
                          ?.removeAttribute("open");
                      }}
                    >
                      <FolderOpen size={16} />
                      <span>
                        Local workspace
                        <small>
                          Use an empty workspace, or return to local projects
                        </small>
                      </span>
                      {mode === "local" && <Check size={16} />}
                    </button>
                    <div className="menu-footnote">
                      <HardDrive size={13} />
                      No account or integration connected
                    </div>
                    <Link href="/login" className="menu-link">
                      Sign in to your workspace
                    </Link>
                  </>
                )}
              </div>
            </details>
          </div>
        </div>
      </header>
      <div className="content-wrap">
        <main id="main-content" tabIndex={-1}>
          {notice && (
            <p className="form-error" role="alert">
              {notice}
            </p>
          )}
          {error ? (
            <EmptyState
              icon={Database}
              title="Your workspace couldn’t be loaded"
              description={error}
              action={
                <button
                  className="button secondary"
                  onClick={() => setReset(true)}
                >
                  {isLive ? "Retry loading" : "Reset browser workspace"}
                </button>
              }
            />
          ) : (
            children
          )}
        </main>
      </div>
      {reset && (
        <ConfirmDialog
          title="Reset browser workspace?"
          description="This removes saved demo and local workspace data from this browser and restores the defaults. This cannot be undone."
          confirmLabel="Reset workspace"
          onClose={() => setReset(false)}
          onConfirm={async () => {
            try {
              await actions.recover();
              setReset(false);
              notify("Workspace reset.");
            } catch (e) {
              return errorMessage(e);
            }
          }}
        />
      )}
    </div>
  );
}

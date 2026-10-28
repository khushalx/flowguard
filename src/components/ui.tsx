"use client";

import Link from "./workspace-link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Circle,
  CircleCheck,
  CircleHelp,
  CircleX,
  LoaderCircle,
  Plus,
  X,
  type LucideIcon,
} from "lucide-react";
import type { RunStatus } from "@/lib/model";
import { useWorkspace } from "@/lib/workspace-store";

export { BrandMark } from "./brand";

const statusInfo: Record<
  RunStatus | "skipped",
  { icon: LucideIcon; label: string }
> = {
  passed: { icon: CircleCheck, label: "Passed" },
  failed: { icon: CircleX, label: "Failed" },
  running: { icon: LoaderCircle, label: "Running" },
  unknown: { icon: CircleHelp, label: "No result" },
  skipped: { icon: Circle, label: "Skipped" },
  queued: { icon: Circle, label: "Queued" },
  error: { icon: CircleX, label: "Execution error" },
  timed_out: { icon: CircleX, label: "Timed out" },
  cancelled: { icon: Circle, label: "Cancelled" },
};
export function StatusIndicator({
  status = "unknown",
  label,
  large = false,
}: {
  status?: RunStatus | "skipped";
  label?: string;
  large?: boolean;
}) {
  const { icon: Icon, label: defaultLabel } = statusInfo[status];
  return (
    <span className={`status status-${status} ${large ? "status-large" : ""}`}>
      <Icon size={large ? 22 : 16} strokeWidth={1.6} aria-hidden="true" />
      <span>{label ?? defaultLabel}</span>
    </span>
  );
}
export function PageHeader({
  leading,
  eyebrow,
  title,
  description,
  action,
}: {
  leading?: ReactNode;
  eyebrow?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      {eyebrow && <div className="breadcrumb">{eyebrow}</div>}
      <div className="page-heading">
        <div>
          <div className="page-title-group">
            {leading}
            <h1>{title}</h1>
          </div>
          {description && <p className="page-description">{description}</p>}
        </div>
        {action && <div className="page-actions">{action}</div>}
      </div>
    </header>
  );
}
export function EmptyState({
  icon: Icon = Plus,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon size={25} strokeWidth={1.3} aria-hidden="true" />
      </div>
      <h2>{title}</h2>
      <p>{description}</p>
      {action && <div className="empty-actions">{action}</div>}
    </div>
  );
}
export function Dialog({
  title,
  description,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = `dialog-${title.toLowerCase().replace(/\W/g, "-")}`;
  useEffect(() => {
    const element = ref.current;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    element?.showModal();
    return () => {
      element?.close();
      queueMicrotask(() => {
        if (
          previousFocus?.isConnected &&
          !document.querySelector("dialog[open]")
        )
          previousFocus.focus();
      });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? "dialog-wide" : ""}`}
      aria-labelledby={titleId}
      aria-describedby={description ? `${titleId}-description` : undefined}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const focusable = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((element) => element.getClientRects().length > 0);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const box = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < box.left ||
            e.clientX > box.right ||
            e.clientY < box.top ||
            e.clientY > box.bottom
          )
            onClose();
        }
      }}
    >
      <div className="dialog-header">
        <div>
          <h2 id={titleId}>{title}</h2>
          {description && <p id={`${titleId}-description`}>{description}</p>}
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function ConfirmDialog({
  title,
  description,
  confirmLabel = "Delete",
  onClose,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: () => void | string | Promise<void | string>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <Dialog title={title} description={description} onClose={onClose}>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button className="button secondary" onClick={onClose} autoFocus>
          Cancel
        </button>
        <button
          className="button destructive"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            try {
              const result = await onConfirm();
              if (result) setError(result);
            } catch {
              setError("The change could not be completed. Try again.");
            } finally {
              setPending(false);
            }
          }}
        >
          {pending ? "Saving…" : confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
export function ExecutionDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      title="Test execution isn’t connected yet"
      description="You can configure projects and journeys. Running them requires a test runner, which will be connected in Phase 3."
      onClose={onClose}
    >
      <div className="info-panel">
        <CircleHelp size={18} />
        <p>
          No test was started. Existing demo results are sample records and
          won’t change.
        </p>
      </div>
      <div className="dialog-actions">
        <button className="button primary" onClick={onClose}>
          Got it <Check size={15} />
        </button>
      </div>
    </Dialog>
  );
}
export function WorkspaceLoading() {
  return (
    <div className="loading-state" role="status">
      <LoaderCircle size={22} className="spin" aria-hidden="true" />
      <span>Loading workspace…</span>
      <div className="skeleton-line" />
      <div className="skeleton-line short" />
    </div>
  );
}
export function MissingRecord({
  kind = "project",
}: {
  kind?: "project" | "run";
}) {
  const { isLive } = useWorkspace();
  return (
    <EmptyState
      icon={CircleHelp}
      title={`This ${kind} isn’t in this workspace`}
      description={
        isLive
          ? "It may have been deleted, or your account may not have access. Return to your workspace to continue."
          : "It may have been deleted, or it may belong to the other workspace. You can switch workspaces in the account menu."
      }
      action={
        <Link
          className="button secondary"
          href={kind === "project" ? "/app/projects" : "/app/runs"}
        >
          <ArrowLeft size={15} /> Back to{" "}
          {kind === "project" ? "projects" : "runs"}
        </Link>
      }
    />
  );
}
export function SectionHeading({
  title,
  count,
  action,
  description,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  description?: string;
}) {
  return (
    <div className="section-heading">
      <div>
        <div className="section-title">
          <h2>{title}</h2>
          {count !== undefined && (
            <span className="count">{String(count).padStart(2, "0")}</span>
          )}
        </div>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function TextLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className="text-link">
      {children}
      <ArrowRight size={14} aria-hidden="true" />
    </Link>
  );
}

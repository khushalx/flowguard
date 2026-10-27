"use client";
import { EmptyState } from "@/components/ui";
export default function ErrorBoundary({ reset }: { reset: () => void }) {
  return (
    <EmptyState
      title="This page couldn’t be displayed"
      description="Your saved workspace is still in this browser. Try loading this page again."
      action={
        <button className="button secondary" onClick={reset}>
          Try again
        </button>
      }
    />
  );
}

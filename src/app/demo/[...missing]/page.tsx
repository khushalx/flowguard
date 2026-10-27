import Link from "@/components/workspace-link";
export default function MissingDemo() {
  return (
    <div className="empty-state">
      <h1>This page doesn’t exist</h1>
      <p>The address may have changed.</p>
      <Link className="button secondary" href="/app">
        Back to overview
      </Link>
    </div>
  );
}

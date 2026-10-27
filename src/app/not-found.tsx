import Link from "next/link";
import { BrandMark } from "@/components/ui";
export default function NotFound() {
  return (
    <main className="standalone-empty">
      <BrandMark />
      <p className="mono muted">404</p>
      <h1>Page not found</h1>
      <p>This address doesn’t lead to a FlowGuard page.</p>
      <Link href="/app" className="button primary">
        Back to overview
      </Link>
    </main>
  );
}

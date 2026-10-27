import { AppShell } from "@/components/app-shell";
import { DemoWorkspaceProvider } from "@/lib/workspace-store";
export default function DemoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DemoWorkspaceProvider>
      <AppShell>{children}</AppShell>
    </DemoWorkspaceProvider>
  );
}

"use client";
import NextLink from "next/link";
import { useRouter as useNextRouter } from "next/navigation";
import { useWorkspaceBase } from "@/lib/workspace-store";
import type { ComponentProps } from "react";
export default function Link(props: ComponentProps<typeof NextLink>) {
  const base = useWorkspaceBase();
  const href =
    typeof props.href === "string" && /^\/app(?:\/|$)/.test(props.href)
      ? base + props.href.slice(4)
      : props.href;
  return <NextLink {...props} href={href} />;
}
export function useWorkspaceRouter() {
  const router = useNextRouter();
  const base = useWorkspaceBase();
  return {
    ...router,
    push: (href: string) => router.push(href.replace(/^\/app(?=\/|$)/, base)),
  };
}

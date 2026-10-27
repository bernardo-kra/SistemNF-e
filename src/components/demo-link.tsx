"use client";
import NextLink from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";
import { demoHref } from "../../shared/workspace-routes.mjs";
export default function DemoLink({ href, ...props }: ComponentProps<typeof NextLink>) {
  const path = usePathname();
  return <NextLink {...props} href={typeof href === "string" ? demoHref(href, path) : href} />;
}

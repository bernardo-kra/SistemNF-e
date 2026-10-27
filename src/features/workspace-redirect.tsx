"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export function WorkspaceRedirect({ to }: { to: string }) {
  const router = useRouter(); useEffect(() => { router.replace(`${to}${window.location.search}`); }, [router, to]);
  return <main><p role="status">Abrindo seu espaço de trabalho…</p></main>;
}

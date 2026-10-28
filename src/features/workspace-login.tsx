"use client";
import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Layers3, ShieldCheck } from "lucide-react";
import { useWorkspace } from "./workspace-session";
import { LoginForm } from "./access-control";
import { workspaceReturnPath } from "../../shared/workspace-routes.mjs";
export function WorkspaceLogin() {
  const session = useWorkspace(), router = useRouter();
  useEffect(() => { if (session.phase === "ready") { const next = new URLSearchParams(window.location.search).get("next"); router.replace(next ? workspaceReturnPath(next) : session.identity?.platformAdmin && !session.identity.tenants.length ? "/administracao/" : "/"); } }, [session.phase, router, session.identity]);
  return <main className="login-page"><section className="login-story"><Link href="/" className="brand brand-light"><span className="brand-mark"><Layers3 /></span><span>sistem.</span></Link><div className="login-copy"><span className="welcome-kicker">GESTÃO E ASSISTÊNCIA</span><h1>Sua loja.<br />Tudo no<br />mesmo lugar<span>.</span></h1><p>Atendimento, estoque e recebimentos<br />com os dados da sua empresa.</p><div className="login-features"><span><ShieldCheck size={17} /> Uma conta individual para cada pessoa</span></div></div><small>Uma nova forma de cuidar da sua operação.</small></section>
    <section className="login-form-panel"><div className="login-form-content">{session.phase === "loading" || session.phase === "ready" ? <p role="status">Conectando à sua conta…</p> : session.phase === "error" ? <><p role="alert">{session.error}</p><button className="button button-primary" onClick={() => void session.refresh()}>Tentar novamente</button></> : <LoginForm error={session.error} onSigned={session.refresh} />}<p className="login-footer">Sistem · Gestão e assistência</p></div></section></main>;
}

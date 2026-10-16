import Link from "next/link";
export default function NotFound() {
  return (
    <main className="not-found">
      <span>404</span>
      <h1>Este caminho não foi encontrado.</h1>
      <p>Volte para sua área de trabalho para continuar.</p>
      <Link className="button button-primary" href="/">
        Ir para a visão geral
      </Link>
    </main>
  );
}

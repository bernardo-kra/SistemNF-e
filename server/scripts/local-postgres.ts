import { loadLocalCredentials, startPortablePostgres } from "./portable-postgres.js";

async function main() {
  if (process.argv.includes("--help")) {
    console.log("Inicia somente o PostgreSQL da pasta server/.local/development, em loopback. Mantenha este terminal aberto e use setup:local em outro terminal. Ctrl+C encerra apenas este cluster.");
    return;
  }
  const { directory, credentials } = await loadLocalCredentials();
  const instance = await startPortablePostgres(directory, credentials);
  let closed = false;
  const stop = () => {
    if (closed) return;
    closed = true;
    void instance.stop().catch(() => { process.exitCode = 1; console.error("Não foi possível encerrar o cluster local de forma regular."); });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  console.log("PostgreSQL local iniciado em loopback. Ctrl+C encerra este processo; os dados de desenvolvimento são preservados.");
  // Keep this owner process alive; it is responsible for stopping the instance it started.
  const keeper = setInterval(() => {}, 1000);
  process.once("SIGINT", () => clearInterval(keeper));
  process.once("SIGTERM", () => clearInterval(keeper));
}

void main().catch(() => {
  console.error("Não foi possível iniciar o cluster local. Confira a pasta privada, a porta e se outro processo já o iniciou.");
  process.exitCode = 1;
});

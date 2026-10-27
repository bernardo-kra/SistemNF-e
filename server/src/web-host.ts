import { stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";

export function webEnvironment(env: NodeJS.ProcessEnv) {
  const portText = env.PORT ?? env.API_PORT ?? "4000";
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || port < 1 || port > 65535) throw new Error("Porta inválida.");
  const hostedUrl = env.APP_PUBLIC_URL ?? env.RENDER_EXTERNAL_URL;
  return { host: env.API_HOST ?? (env.RENDER_EXTERNAL_URL ? "0.0.0.0" : "127.0.0.1"), port,
    publicUrl: hostedUrl ?? `http://127.0.0.1:${port}`, nodeEnv: env.NODE_ENV ?? (hostedUrl ? "production" : "development") };
}

export async function registerFrontend(app: FastifyInstance, directory: string): Promise<void> {
  const root = resolve(directory);
  if (!(await stat(resolve(root, "index.html"))).isFile()) throw new Error("Execute o build antes de iniciar a aplicação.");
  await app.register(fastifyStatic, {
    root, index: "index.html", redirect: true, dotfiles: "deny", serveDotFiles: false,
    allowedPath: (path) => !path.split(/[\\/]/).some((part) => part.startsWith(".")) &&
      !/^\/?(?:api|health)(?:\/|$)/.test(path),
    setHeaders: (response, path) => {
      const immutable = path.includes(`${sep}_next${sep}static${sep}`);
      response.header("cache-control", immutable ? "public, max-age=31536000, immutable" : "no-cache");
      response.header("x-content-type-options", "nosniff");
    },
  });
}

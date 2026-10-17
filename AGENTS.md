<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Equipe do Sistem

Os perfis `analista`, `desenvolvedor` e `qa` estao em `.codex/agents`. Leia `docs/10-equipe-de-agentes.md` para responsabilidades, fluxo e limites. Quando o usuario pedir a equipe, o agente principal coordena: analista define o recorte, desenvolvedor implementa os arquivos atribuidos e QA verifica a entrega de forma independente. Investigue em paralelo apenas o que nao depende de outra entrega; nao edite os mesmos arquivos concorrentemente.

Os perfis nao autorizam implementar todo o backlog, iniciar outros agentes ou publicar. Preserve mudancas do usuario e diferencie especificacao, simulacao e integracao real. O financeiro ampliado de `docs/09-financeiro-pagamentos-e-fluxo-de-caixa.md` ainda e uma especificacao; confirme o estado atual no codigo. Se alterar os perfis nesta workspace, sincronize suas copias no diretorio pai `.codex/agents` quando esse diretorio existir.

# Primeiro recorte do backend

## Autorização e recorte — 18/10/2026

O usuário autorizou começar o backend. A aplicação existente é uma exportação estática Next.js/React/TypeScript/CSS com dados demonstrativos no navegador. Este recorte inicia uma API Node.js/TypeScript em `server/`, com PostgreSQL real, identidade central, vínculos e bancos operacionais separados por empresa. Não migra os dados locais nem conecta parcialmente as telas operacionais à API; o uso pelo navegador e a migração dos demais módulos têm entregas próprias.

**Estado em 19/10/2026: preparação parcial, sem API implementada.** Contratos e 30 cenários de teste foram escritos antes do código de produto. Existem manifesto/lockfile, configuração TypeScript e ferramentas iniciais de PostgreSQL local; ainda não há `server/src`, migrações ou servidor HTTP. Arquiteto avaliou a estrutura por leitura. Coordenador mantém configuração, ferramentas e este documento; QA escreve os testes e verifica independentemente; desenvolvedor recebe implementação após os testes prévios e o registro correto de seus limites.

## Decisões

- Fastify 5, Better Auth e `pg`, com versões verificadas e fixadas em manifesto/lockfile próprios. Better Auth fornece senha/sessão; não implementar mecanismo próprio de autenticação. Sessões persistem no banco central, sem cache de cookie que atrase revogação.
- A API funciona em processo independente, preservando o build estático e as jornadas atuais. Um único processo modular basta neste recorte.
- Identidade e vínculos ficam no banco central. Clientes e auditoria do cadastro ficam exclusivamente no banco operacional autorizado. A API recebe configuração de conexão somente do servidor; nomes/URLs de banco enviados pelo cliente nunca são usados.
- Contexto de empresa **explícito na rota de cada requisição**, validado novamente no servidor. `GET /api/v1/me` oferece as empresas permitidas. Não há variável global de empresa atual nem seleção mutável compartilhada entre sessões/abas. O endpoint de seleção de sessão sugerido no documento 03 fica adiado; o futuro frontend deve cancelar/descartar respostas de um contexto anterior.
- Provisionamento e migrações usam credencial administrativa distinta, fora do processo HTTP. Runtime usa roles sem superuser, criação de banco, criação de role ou DDL. Conexão pública aos bancos locais é revogada; cada role operacional acessa somente seu banco. Pools têm limites por banco e total de empresas configuradas.
- Cadastro público fechado. Usuários e vínculos são provisionados por ferramenta local explícita; a instância de autenticação HTTP sempre desabilita signup. A ferramenta de provisionamento usa a própria biblioteca, sem criar hash/senha ou sessão manualmente.
- Desenvolvimento/testes usam PostgreSQL embarcado como ferramenta local; não é infraestrutura de produção. Docker/PostgreSQL não estavam disponíveis no PATH na inspeção. O cluster deve ouvir somente no loopback, guardar configuração ignorada pelo Git e encerrar os processos que iniciar.

## Contratos HTTP e de dados

Base local prevista: `http://127.0.0.1:4000`. Origem do frontend permitida explicitamente: `http://127.0.0.1:3000`. Origem permitida não substitui sessão. Cookies `HttpOnly`, `SameSite=Lax`; `Secure` obrigatório fora de desenvolvimento HTTP em loopback. Mutações exigem Origin permitido, inclusive login/logout. Não armazenar sessão em localStorage nem retornar token em DTO.

Login será limitado a cinco tentativas por 60 segundos por IP da conexão, retornando `429` ao exceder. Headers de IP fornecidos pelo cliente não podem alterar esse limite. Configuração prevista: `NODE_ENV`, `API_HOST`, `API_PORT`, `API_BASE_URL`, `FRONTEND_ORIGIN`, `BETTER_AUTH_SECRET`, `CONTROL_DATABASE_URL` e `TENANT_DATABASE_URLS`; esse último é um mapa interno com no máximo 16 conexões. Segredo de autenticação com ao menos 32 caracteres; produção exige origens HTTPS explícitas. Esses contratos ainda precisam de implementação e aprovação dos testes.

| Método e rota | Comportamento esperado |
| --- | --- |
| `GET /health/live` | Vivacidade sem dados/segredos. |
| `GET /health/ready` | Banco central disponível; `503` controlado se indisponível. |
| `POST /api/auth/sign-in/email` | Better Auth valida credenciais e devolve cookie; resposta pública não inclui token de sessão. |
| `POST /api/auth/sign-out` | Revoga sessão; cookie antigo deixa de autorizar imediatamente. |
| Demais `/api/auth/*` | Não expostos neste recorte, incluindo signup público. |
| `GET /api/v1/me` | Usuário `{id,name,email}` e `tenants:[{id,name,role,permissions}]` de vínculos ativos. Sem configuração interna de banco ou sessão. |
| `GET /api/v1/tenants/:tenantId/customers` | Página `{tenantId,items,total,limit,offset}`. `limit` 1–100, padrão 25; `offset` 0–10000, padrão 0; `q` até 100 caracteres, busca textual literal. Ordenação estável por nome e ID. |
| `GET /api/v1/tenants/:tenantId/customers/:id` | `{tenantId,customer}` apenas do banco autorizado; inexistente retorna `404`. |
| `POST /api/v1/tenants/:tenantId/customers` | Campos `{name,email?,phone?,type}`; ID e versão gerados no servidor. Retorna `201 {tenantId,customer}`. |
| `PATCH /api/v1/tenants/:tenantId/customers/:id` | `{version,...camposAlterados}` incluindo `active` opcional. Versão obsoleta `409`, inexistente `404`; edição concorrente não sobrescreve silenciosamente. |

Cliente: `{id,name,email,phone,type,active,version,createdAt,updatedAt}`. `type` é `Pessoa física` ou `Empresa`, como no protótipo; nome obrigatório até 120 caracteres, e-mail até 254, telefone até 32; strings aparadas. Vazio é permitido para e-mail/telefone. O recorte não recebe documento/endereço fiscal. PATCH exige versão inteira positiva e ao menos um campo alterável. Campos desconhecidos são recusados, incluindo IDs, empresa, autoria e datas. Não há exclusão física: inativar preserva o registro.

Permissões: `owner` e `operator` podem ler/escrever clientes; `viewer` pode apenas ler. Sem sessão válida: `401`; vínculo ausente/revogado ou permissão insuficiente: `403`; entrada inválida: `400`; conflito: `409`; dependência indisponível: `503`. Erros da API seguem `{error:{code,message,requestId}}`, sem stack, SQL, body ou segredo. Request ID vem do servidor, mesmo que o cliente envie outro. Respostas autenticadas usam `Cache-Control: no-store`.

O cadastro confirma um único fato e gera registro e auditoria na mesma transação. Auditoria contém identificador, instante, empresa/autor autorizados, ação, entidade e versão; não replica dados pessoais. Não altera estoque, OS, fiscal, pagamentos ou dados no navegador. Banco indisponível não aciona fallback para outro banco ou para os exemplos.

## Contratos internos acordados para testes

- `readConfig(env)` retorna `{nodeEnv,host,port,baseUrl,frontendOrigin,authSecret,controlDatabaseUrl,tenantDatabaseUrls}`, com mapa de chave interna para URL PostgreSQL. Segredos obrigatórios, origens sem wildcard e limites de conexões validados. Sem URLs de banco ou senhas padrão em código de produção.
- `createAuth(controlPool, config, provisioning=false)` configura Better Auth; signup somente na instância explícita de provisionamento e sem login automático. HTTP usa sempre `false`.
- `migrateControl(pool)` / `migrateTenant(pool)` aplicam migrações versionadas em transação, repetíveis sem perder dados. Executadas por credencial de migração, nunca automaticamente pelo servidor HTTP.
- `buildApp({config,controlPool,logger?})` retorna instância Fastify pronta para `inject`/`listen`; não inicia porta nem migra banco. Fecha seus pools operacionais no encerramento; quem fornece `controlPool` encerra esse pool. Logs usam catálogo/rota modelo/status/request ID e contexto já autorizado, sem body/query/cookies/erro bruto.
- Tabelas centrais da aplicação: `tenants(id uuid,name,database_key,active)` e `memberships(user_id text,tenant_id uuid,role,active)`, além do esquema gerado pela biblioteca de autenticação. Operacionais: `customers` e `audit_events`. Tests podem semear entidades por SQL usando somente credenciais administrativas do cluster isolado.

## Critérios de aceite definidos antes do código

| ID | Cenário esperado |
| --- | --- |
| BE-01 | Login válido/credencial inválida, cookie protegido, origem indevida/ausente recusada nas mutações e signup público fechado. |
| BE-02 | Expiração e logout invalidam cookie; DTO/log/erro não expõe token, senha, conexão ou conteúdo pessoal. |
| BE-03 | Sessão vinculada só a A não lê/escreve B, mesmo com ID válido e header forjado. Banco B e seus registros permanecem intactos. |
| BE-04 | Usuário com vínculos A/B faz requisições intercaladas sem cruzar dados; revogar vínculo passa a negar a requisição seguinte. Viewer não grava. |
| BE-05 | Criar/consultar/filtrar/paginar/editar/inativar cliente persiste após reconstruir app/pools. Auditoria deriva autor/empresa do servidor e acompanha cada escrita confirmada. |
| BE-06 | Campos extras, tipo/versão/dados inválidos são recusados sem gravação. Texto com sintaxe SQL não vira comando. |
| BE-07 | Duas edições reais concorrentes da mesma versão: uma confirma, outra retorna `409`; um único incremento e uma auditoria de atualização. |
| BE-08 | Indisponibilidade responde `503` controlado sem fallback ou segredo; readiness informa falha. |
| BE-09 | Migrações repetidas preservam dados; transação evita gravação de cadastro sem auditoria. Role runtime não faz DDL e role A não conecta ao banco B. |
| BE-10 | Um smoke usa HTTP real em loopback, além dos testes de integração com `inject`. Protótipo existente continua passando tipos, testes e build. |

## Execução e evidências

Checkpoint solicitado pelo usuário em 19/10/2026, antes de continuar a implementação:

- Dependências instaladas com lockfile próprio em `server/`; ferramentas iniciais de cluster isolado e roles locais preparadas. A execução completa dessas ferramentas ainda não tem aprovação registrada. A inspeção no checkpoint não encontrou processo `postgres.exe` ativo.
- QA escreveu 26 cenários em `server/test/backend.test.ts` e quatro em `server/test/config.test.ts`, com utilitários em `helpers.ts`, antes de existir código de produto.
- `npm.cmd test`, executado em `server/` no checkpoint, terminou com erro de importação: faltam `src/migrations.ts` e `src/config.ts`. Os dois arquivos de entrada falharam e **os 30 cenários não chegaram a executar**. Isso comprova a ausência da implementação; não é um RED funcional de 30 casos e não aprova qualquer contrato de segurança ou banco.
- `npm.cmd run typecheck` do frontend passou novamente no checkpoint. O backend tem configuração TypeScript separada e está excluído da compilação Next.js; não foi aprovado em tipos/build.
- As entregas anteriores do frontend têm resultados próprios nos documentos 11/12. A regressão de 96 casos e o build aprovados naquela entrega não são validação deste backend.

Os scripts `dev`, `start`, `db:local` e `setup:local` de `server/package.json` antecipam os próximos arquivos e **ainda não são comandos de uma API utilizável**. A retomada deve implementar a preparação mínima das fixtures, obter falhas funcionais dos cenários e só então concluir os comportamentos, preservando as expectativas independentes do QA. Nenhum endpoint, autenticação, isolamento, migração operacional ou integração do frontend está entregue neste checkpoint. Credenciais, dados do cluster, dependências instaladas e `dist/` ficam fora do Git.

## Fontes verificadas

- [Fastify: integração de banco](https://fastify.dev/docs/latest/Guides/Database/) e [validação](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/).
- Better Auth: [Fastify](https://better-auth.com/docs/integrations/fastify), [PostgreSQL](https://better-auth.com/docs/adapters/postgresql), [senha](https://better-auth.com/docs/authentication/email-password), [sessões](https://better-auth.com/docs/concepts/session-management) e [rate limit](https://better-auth.com/docs/concepts/rate-limit).
- [Privilégios do PostgreSQL](https://www.postgresql.org/docs/current/ddl-priv.html), [transações do pg](https://node-postgres.com/features/transactions), [pools do pg](https://node-postgres.com/features/pooling) e [mantenedor do PostgreSQL embarcado](https://github.com/leinelissen/embedded-postgres).
- Documentação instalada do Next.js 16.4.2: `node_modules/next/dist/docs/01-app/02-guides/static-exports.md` e `01-app/01-getting-started/05-server-and-client-components.md`.

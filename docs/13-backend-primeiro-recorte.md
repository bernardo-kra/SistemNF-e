# Primeiro recorte do backend

## Neon e homologação no Render — 27/10/2026

**Continuidade autorizada pelo usuário:** encerrar instância local, commitar/enviar código e fazer funcionar online. A instância local permanente foi encerrada; processos temporários dos testes se encerram ao concluir. Primeiro gestor da empresa informada pelo usuário foi provisionado explicitamente com senha aleatória em arquivo privado ignorado pelo Git, sem exibir a senha ou criar conta demonstrativa no banco real. Estado anterior abaixo é o checkpoint da preparação.

CLI Render 2.32.0 obtido da release oficial e verificado por SHA-256, apenas em `server/.local/tools`; autenticação pelo navegador com configuração privada em `server/.local/render`, sem instalação/configuração global. Serviço existente `SistemNF-e` (`srv-dbgacg59fdbs73d89sd0`, repositório `bernardo-kra/SistemNF-e`, branch `main`) confirmado no plano `free`, destino `https://sistemnf-e.onrender.com/operacao/`. Configurados build `npm ci --include=dev && npm run build`, start `npm start`, saúde `/health/ready` e variáveis de runtime do Neon em ambiente privado, preservando `PORT`. O outro serviço da workspace não foi alterado. A aplicação do código e a validação HTTPS seguem a confirmação do commit/deploy, sem apresentar esses ajustes de configuração como publicação já aprovada.

Verificação pré-publicação: suíte completa de backend **110/110 aprovados** (14,5 minutos), incluindo OP16 com catálogo FIN-LIVE exato e preservação de dados na preparação remota. Builds/tipos aprovados. Nova falha de ambiguidade de código foi reproduzida antes da correção no FIN-UI15 e no endpoint real; depois passaram 24 testes FIN/OP e o smoke real Neon com busca exata, checkout/entrada/parcelas, recebimento posterior e replay sem duplicação, além dos checks de sessão/acesso anteriores. Detalhes e revisão independente no [FIN-LIVE](11-financeiro-primeiro-recorte.md). A regressão anterior de 250 cenários e os 24 finais verificam 251 cenários únicos em rodadas, sem alegar uma única rodada de 251.

Primeiro deploy `528769c` ficou live no Render, com login/sessão segura/reload aprovados, porém produtos e financeiro responderam 503. Banco operacional e migrações foram conferidos por leitura com a role de runtime: disponíveis e válidos. Hipótese investigada: orçamento de conexão de 800ms insuficiente entre Render e Neon (consulta remota falhando em aproximadamente 1,5s incluindo transporte HTTP). Opções do pool foram extraídas sem mudar valores antes do ensaio; `test/neon-pool-smoke.ts` define leitura SQL após atraso artificial de 1s no handshake, mantendo TLS validado. Não altera dinheiro, estoque, autenticação ou tempo máximo dos comandos SQL. Confirmar RED antes de ajustar orçamento de conexão e validar novamente em HTTPS; não ocultar 503 com dados da demonstração ou retentativas sem limite.

Ensaio: com 800ms, falhou em 802ms (RED); com conexão limitada a 15000ms, TLS e `SELECT 1` passaram em 1184ms (GREEN). Mantidos pool máximo 2, idle 10000ms e `statement_timeout=5000`. Tipos, 12 verificações rápidas e build completo aprovados. Consultas reais de produtos/financeiro com a role do banco primário também passaram fora do Render, sem inserir dados. Revisor independente conferiu alteração e proxy por leitura, sem bloqueadores; a verificação HTTPS continua obrigatória após publicar a correção. Teste reproduzível opt-in: em `server`, `node --env-file=../.env.neon.local --import tsx test/neon-pool-smoke.ts`; somente leitura, exige configuração privada, não integra a suíte offline padrão.

Pedido: conectar PostgreSQL/Auth pelo CLI Neon e corrigir `Missing script: start` no Render. O último projeto informado, `round-wind-47684434`, é o destino; `wandering-bar-87117671` não foi alterado. Preservar o recorte financeiro ainda não commitado. Não publicar nem fazer push automaticamente.

Aceite prévio: `npm run build` gera o export e o backend; `npm start` atende a porta da hospedagem, HTML/assets/rotas diretas e API no mesmo endereço; arquivos privados não são servidos; rotas ausentes não retornam HTML com sucesso; configuração ausente não simula uma API pronta. Testes HOST01/02 e de origem da API escritos antes do comportamento e executados para registrar a falha. PostgreSQL remoto deve preservar bancos de controle/empresa, migrações e credenciais de runtime separadas, sem importar localStorage. Validar serviços reais e sessão/autorizações, não apenas build. Autenticação gerenciada envolve decisão sobre o provedor existente; nenhuma troca silenciosa de identidade ou concessão de acesso por e-mail.

Decisão do usuário: manter Better Auth existente e usar PostgreSQL no Neon. Neon Auth já habilitado foi preservado, sem se tornar provedor do Sistem. NEON01 (reaplicação, isolamento e privilégios) passou no PostgreSQL isolado antes da execução remota. NEON02 define primeiro gestor, repetição sem redefinir senha e recusa de promoção; seu primeiro ensaio encontrou erro de fixture: as chaves `a`/`b` já pertenciam a outras empresas, portanto reutilizar `a` violava a unicidade exigida. A fixture foi corrigida para banco/chave próprios `c`; expectativas de identidade e autorização foram preservadas.

O smoke remoto usa o export e a API compilados, Chrome real e dois bancos QA adicionais no mesmo branch, sem interceptação. O primeiro ensaio passou login/reload/gravação, mas o oráculo de auditoria usava `product.created`; o contrato operacional existente registra o tipo do comando `product.create`. Corrigido apenas esse identificador, mantendo a exigência de exatamente um evento para o produto criado.

**Estado:** implementação e testes do recorte Neon/host concluídos; publicação desta versão no Render e criação do gestor real são etapas explícitas, ainda não executadas. CLI global instalado conforme pedido. O primeiro `init` falhou ao configurar GitHub Copilot CLI; a repetição com `--agent codex` concluiu. Login concluído no navegador; `neon config plan`/`neon deploy` verificaram o branch e o deploy terminou com código 0, sem mudanças na política existente, recebendo cinco variáveis em `.env.local`. `setup:neon` terminou com código 0 e validou credenciais distintas para os dois bancos da aplicação.

Verificações executadas:

- HOST01–03: export HTML/assets, rotas diretas/API, bloqueio de arquivos privados, build ausente e configuração de host/porta. RED antes do código; três aprovados.
- Origem da API: HTTPS hospedado na mesma origem, desenvolvimento 3000→4000 e recusa de configuração inválida. RED antes do código; um aprovado.
- NEON01: migrações, reaplicação sem perder registros, runtime sem DDL e isolamento controle/empresa. RED antes do código; aprovado em PostgreSQL isolado.
- NEON02: primeiro gestor explícito, repetição sem redefinir senha e recusa de promoção por e-mail. RED antes do código; aprovado em PostgreSQL isolado após corrigir a fixture documentada acima.
- Revisão independente por `revisao_neon`, somente leitura, apontou dois P2: marcador criado em autocommits separados e destino do gestor validado apenas por hostname. Corrigidos com transação no mesmo client e validação de nome/marcador do banco antes de criar identidade. NEON03 reproduziu a falha ao inserir marcador por event trigger em cluster isolado; confirmou RED e depois GREEN, incluindo reaplicação. NEON04/05 confirmaram RED e GREEN para recusar banco QA/outro host/marcador divergente. Reinspeção independente não encontrou nova pendência nesses pontos; execução dos testes é do coordenador.
- A revisão também identificou risco condicional de omitir TypeScript no build com `NODE_ENV=production`; `postinstall` do backend e comando do Render passaram a incluir `--include=dev`. A dependência transitiva `fast-uri` recebeu atualização compatível; auditoria npm do servidor passou de uma ocorrência moderada para zero.
- Regressão completa frontend: `npm.cmd test`, **250 cenários aprovados**, mais **quatro checks Node**, em 2,7 minutos. Tipos do frontend/backend aprovados. A suíte completa de backend não foi repetida nesta etapa; não interpretar esses resultados como homologação de todo o backlog financeiro/operacional.
- `npm.cmd start` iniciou a aplicação compilada em loopback. `/`, `/operacao/`, `/health/live` e `/health/ready` responderam 200; `/api/v1/me` sem sessão respondeu 401 e `/.env` respondeu 404. Nenhum gestor padrão foi criado no banco da empresa.
- `npm.cmd run smoke:neon`: aprovado com Chrome real, API/export compilados e PostgreSQL remoto em bancos QA separados. Resultado: `readyStatus=200`, `anonymousStatus=401`, `browserLogin=true`, `sessionAfterReload=true`, `browserWritePersistedInNeon=true`, `auditRecorded=true`, `sharedAcrossBrowsers=true`, `employeeProductsStatus=403`, `afterLogoutStatus=401`, `logoutBrowser=true`. Não comprova tempo de resposta ou disponibilidade do Render.

Evidências privadas sem credenciais nos resumos: `server/.local/validation/neon-build-final.log`, `neon-browser-result.json`, `neon-browser-regression.log`, `neon-owner-final.log`, `neon-atomic-red.log`/`neon-atomic-final.log`. Configuração passo a passo no [guia de homologação](../server/README.md#neon-e-render-homologação). O nome `production` é o nome de branch solicitado no Neon, não uma declaração de prontidão para operação real. Permanecem fora deste recorte: migração de dados reais, integrações bancárias/fiscais, backup/restauração ensaiados, testes de carga e publicação no Render. Segredos, `.neon` e estado privado permanecem ignorados pelo Git.

Repetição final após as correções: `npm.cmd ci --include=dev` concluiu com zero vulnerabilidades em ambos os manifestos; `npm.cmd run build` terminou com código 0, exportou 21 rotas e compilou o backend; `npm.cmd run smoke:neon` terminou novamente com código 0 e os dez checks aprovados. A aplicação final foi iniciada com `npm.cmd start` em `http://127.0.0.1:4000`.

## Autorização e recorte — 18/10/2026

O usuário autorizou começar o backend. A aplicação existente é uma exportação estática Next.js/React/TypeScript/CSS com dados demonstrativos no navegador. Este recorte inicia uma API Node.js/TypeScript em `server/`, com PostgreSQL real, identidade central, vínculos e bancos operacionais separados por empresa. Não migra os dados locais nem conecta parcialmente as telas operacionais à API; o uso pelo navegador e a migração dos demais módulos têm entregas próprias.

**Estado em 19/10/2026: preparação parcial, sem API implementada.** Contratos e 30 cenários de teste foram escritos antes do código de produto. Existem manifesto/lockfile, configuração TypeScript e ferramentas iniciais de PostgreSQL local; ainda não há `server/src`, migrações ou servidor HTTP. Arquiteto avaliou a estrutura por leitura. Coordenador mantém configuração, ferramentas e este documento; QA escreve os testes e verifica independentemente; desenvolvedor recebe implementação após os testes prévios e o registro correto de seus limites.

**Retomada em 24–25/10/2026:** o pedido de autoria/horário, filtros e controle por funcionário priorizou esta fundação. Em 25/10 o usuário escolheu explicitamente login real e dados compartilhados. API, configuração, migrações e ferramentas estão implementadas e verificadas localmente. O painel conectado e as permissões configuráveis de clientes também foram entregues no [recorte ACC](15-auditoria-acessos-e-filtros.md), com validação independente. Produtos/OS/compras e demais direitos operacionais permanecem pendentes. O histórico de 19/10 abaixo permanece como registro do checkpoint, sem representar o estado atual.

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

Login limitado a cinco tentativas por 60 segundos por IP da conexão, retornando `429` ao exceder. Headers de IP fornecidos pelo cliente não podem alterar esse limite. Configuração: `NODE_ENV`, `API_HOST`, `API_PORT`, `API_BASE_URL`, `FRONTEND_ORIGIN`, `BETTER_AUTH_SECRET`, `CONTROL_DATABASE_URL` e `TENANT_DATABASE_URLS`; esse último é um mapa interno com no máximo 16 conexões. Segredo de autenticação com ao menos 32 caracteres; produção exige origens HTTPS explícitas. Implementação e evidências atuais estão na retomada abaixo.

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

## Retomada executada — 25/10/2026

Implementados `server/src` e as ferramentas locais descritas no [guia de execução](../server/README.md), sem alterar a fonte de dados do protótipo. Testes usam somente clusters isolados e dados fictícios; nenhum gestor real, banco de produção ou publicação foi criado nesta rodada.

A preparação mínima das fixtures permitiu executar os cenários funcionais antes de completar a API: configuração positiva falhou nos stubs e cenários HTTP falharam nas respostas provisórias. Depois da implementação, a primeira suíte de 33 passou. A revisão estrutural acrescentou testes antes de corrigir dois problemas reproduzidos: migrações concorrentes podiam esgotar o pool de duas conexões; readiness aceitava schema incompatível quando apenas a conexão respondia. A introspecção da migração foi movida para antes do lock transacional e a prontidão passou a aguardar a validação da biblioteca. Preparação local ganhou teste de credenciais runtime realmente funcionais antes de escrever a configuração; o primeiro RED mostrou anúncio indevido de sucesso quando a senha interna havia sido alterada.

A suíte foi ampliada para 39 cenários (29 API, quatro configuração, três dados explícitos do gestor, duas infraestrutura, um preparação). Uma execução inicial teve 38 aprovados e falha no intervalo de horário da auditoria. A investigação isolada de 50 operações/100 eventos mostrou cinco eventos 1 ms à frente do limite `Date.now()` do Node, nenhum fora dos limites de `clock_timestamp()` do PostgreSQL e zero diferença entre driver e epoch truncado do banco. O oráculo passou a comparar limites do mesmo relógio autoritativo, sem tolerância adicional, mantendo UTC, autoria, versões, recusa de forjado e no-op. Não houve mudança de comportamento para fazer o teste passar.

A rodada independente seguinte aprovou os 39 cenários funcionais, mas terminou com exit code 1 pelo encerramento de um cluster: o PostgreSQL recebeu a parada regular e terminou após 52,393 s (51,982 s de sincronização), além do deadline de 30 s da ferramenta. O STOP local passou para 90 s com timeout de processo de 120 s. A execução RED posterior da nova migração encerrou regularmente com esse limite. O resultado completo após a correção da ferramenta permanece em validação; não tratar 39 aprovações funcionais com hook falho como suíte inteiramente aprovada.

Na primeira regressão web desta retomada, 215/216 casos e os três checks estáticos passaram. O caso de navegação na importação registrou Fast Refresh durante upload/confirmação, mesma URL e apenas GET inicial do documento; a repetição com fontes estáveis registrou `passed` em `test-results/.last-run.json`, mas o canal do processo foi perdido antes de recuperar seu resumo completo. A regressão atual inclui também o painel e terá evidência própria; não atribuir contagens novas àquele arquivo isoladamente.

O usuário pediu seguir para o [painel de contas ACC](15-auditoria-acessos-e-filtros.md), acrescentando `control_002` e direitos configuráveis de clientes. Sua validação é separada da fundação acima. O teste de migração foi atualizado para exigir as duas versões por esse requisito explícito, preservando concorrência/repetição.

**Fechamento:** a repetição independente dos 39 testes passou com exit code 0 e cleanup regular. Mais 14 testes de contas e dois complementares de infraestrutura passaram, totalizando 55 cenários únicos verificados em rodadas. A regressão web passou 226 casos e três checks estáticos; após um ajuste pontual no painel, seus 11 testes, tipos e build passaram. Builds e tipos do servidor também passaram. O smoke com Chrome/cookies/PostgreSQL reais confirmou cadastro, autorização/revogação imediata e logout. Métodos, contagens sem duplicação, capturas e pendências estão no documento 15. Readiness agora confere as duas migrações e campos centrais necessários, além do schema de autenticação; vivacidade segue independente do banco. Nenhum processo de banco/API/Chrome dos testes ficou ativo. Uma pasta temporária ignorada permanece por rejeição automática da sua exclusão recursiva, com o banco já encerrado.

## Continuidade operacional — 26/10/2026

A área `/operacao/` acrescenta produtos, estoque, vendas, OS e compras à mesma identidade/empresa do painel. `tenant_002` acrescenta tabelas operacionais e histórico antes/depois, preservando os clientes existentes. O contrato, protocolo TDD, evidências finais e limites desta nova entrega ficam no [registro OP do documento 15](15-auditoria-acessos-e-filtros.md). A demonstração continua independente; iniciar a API não importa localStorage. Financeiro, caixa, fiscal, relatórios, peças e séries não foram conectados por esta etapa. Use as ferramentas explícitas de preparação para atualizar bancos locais; não há migração automática por HTTP. A revisão independente da etapa OP está pendente, sem reaproveitar o parecer anterior de ACC para aprová-la.

## Fontes verificadas

- [Fastify: integração de banco](https://fastify.dev/docs/latest/Guides/Database/) e [validação](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/).
- Better Auth: [Fastify](https://better-auth.com/docs/integrations/fastify), [PostgreSQL](https://better-auth.com/docs/adapters/postgresql), [senha](https://better-auth.com/docs/authentication/email-password), [sessões](https://better-auth.com/docs/concepts/session-management) e [rate limit](https://better-auth.com/docs/concepts/rate-limit).
- [Privilégios do PostgreSQL](https://www.postgresql.org/docs/current/ddl-priv.html), [transações do pg](https://node-postgres.com/features/transactions), [pools do pg](https://node-postgres.com/features/pooling) e [mantenedor do PostgreSQL embarcado](https://github.com/leinelissen/embedded-postgres).
- Documentação instalada do Next.js 16.4.2: `node_modules/next/dist/docs/01-app/02-guides/static-exports.md` e `01-app/01-getting-started/05-server-and-client-components.md`.

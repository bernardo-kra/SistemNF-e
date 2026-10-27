# Sistem API

## Neon e Render: homologação

Configuração de 27/10/2026: projeto Neon `round-wind-47684434`, branch `production`, mantendo Better Auth do Sistem. O branch tem esse nome na plataforma, mas este ambiente é de homologação. `wandering-bar-87117671` não foi alterado. PostgreSQL usa `pg` e conexões **diretas**, pois o serviço de contas mantém advisory locks de sessão; conexão por pool transacional externo não preservaria esse contrato. Credenciais administrativas ficam somente nas ferramentas de preparação.

O CLI já criou `neon.ts`, vinculou `.neon` e executou `neon deploy`, que recebeu `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_BRANCH`, `NEON_AUTH_BASE_URL` e `NEON_AUTH_JWKS_URL` em `.env.local` privado. Neon Auth já habilitado foi preservado; essas duas últimas variáveis não substituem o login existente nem são consumidas pelo Sistem.

Na pasta `D:\SistemNF-e\web`, após o vínculo/autenticação no CLI:

```powershell
npm.cmd install
neon.cmd deploy
npm.cmd run setup:neon
```

`setup:neon` cria/reutiliza dois bancos próprios com marcador de ambiente, aplica as migrações e testa as conexões de runtime. Recusa banco ocupado sem seu marcador e roles privilegiadas, sem apagar dados. Roles, senhas, segredo de autenticação e ID da empresa são preservados em `server/.local/neon/round-wind-47684434/state.json`; mantenha esse arquivo privado para reaplicar a preparação. Não troque senhas manualmente para contornar conflitos. O runtime resultante fica em `.env.neon.local`, ignorado pelo Git; não contém a senha administrativa ou a senha do gestor. Este comando não cria um gestor padrão.

Para preparar **seu primeiro gestor**, informe os dados explicitamente no PowerShell, ainda em `web`:

```powershell
$env:SISTEM_OWNER_NAME = Read-Host "Nome do gestor"
$env:SISTEM_OWNER_EMAIL = Read-Host "E-mail do gestor"
$env:SISTEM_COMPANY_NAME = Read-Host "Nome da empresa de teste"
$neonOwnerSecret = Read-Host "Senha (mínimo 12 caracteres)" -AsSecureString
try {
  $env:SISTEM_OWNER_PASSWORD = [System.Net.NetworkCredential]::new("", $neonOwnerSecret).Password
  npm.cmd run setup:neon:owner
} finally {
  Remove-Item -LiteralPath Env:SISTEM_OWNER_PASSWORD -ErrorAction SilentlyContinue
  $neonOwnerSecret.Dispose()
}
npm.cmd run build
npm.cmd start
```

Abra `http://127.0.0.1:4000/operacao/`. A preparação não redefine senha, não promove conta por coincidência de e-mail e não cria outro gestor ao repetir. Uma falha entre criar identidade e confirmar vínculo pode exigir recuperação administrativa explícita; preserve identidade e registros da tentativa. O modo de desenvolvimento em duas portas (`web` 3000/API 4000) continua disponível. `npm start` local usa loopback; Render usa `0.0.0.0` e `PORT`.

No **Web Service Free do Render**, conectado ao repositório da pasta `web`:

| Campo | Valor |
|---|---|
| Root Directory | vazio se a raiz do repositório já é `web`; `web` somente se essa pasta estiver dentro do repositório remoto |
| Build Command | `npm ci --include=dev && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/health/ready` |
| `NODE_ENV` | `production` |
| `BETTER_AUTH_SECRET` | valor privado gerado em `.env.neon.local` |
| `CONTROL_DATABASE_URL` | valor privado gerado em `.env.neon.local` |
| `TENANT_DATABASE_URLS` | JSON gerado em `.env.neon.local`, sem as aspas simples externas do formato dotenv |

O Render fornece `RENDER_EXTERNAL_URL` e `PORT`; API e frontend usam essa mesma origem, com HTTPS e cookies seguros. Se houver `NEXT_PUBLIC_API_URL` antigo apontando para localhost/outra API, remova-o e faça novo build para usar a mesma origem. `API_BASE_URL` e `FRONTEND_ORIGIN`, se definidos explicitamente, devem corresponder à URL HTTPS atual. `APP_PUBLIC_URL` é alternativa explícita ao endereço fornecido pelo Render. Não colocar `DATABASE_URL` administrativa no ambiente de runtime do Render; copiar somente os três valores gerados acima. Não copiar `.env.local`, manifests ou senhas para o Git ou para variáveis `NEXT_PUBLIC_*`.

Teste remoto reproduzível: com Chrome instalado e porta 4000 livre, execute `npm.cmd run smoke:neon` na pasta `web`, após o build. Ele cria/reutiliza dois bancos QA próprios, separados dos dois bancos da aplicação, e mantém apenas dados fictícios neles. Não roda no build, não apaga bancos e não cria um gestor de teste no banco da sua empresa. Verifica login no navegador, sessão após reload, produto e auditoria no Neon, leitura em outro navegador, funcionário sem direito recebendo 403 e logout recebendo 401. Estado privado QA fica em `server/.local/neon/.../qa-state.json`, resultado sem credenciais em `server/.local/validation/neon-browser-result.json`. Evidências e limites em [documento 13](../docs/13-backend-primeiro-recorte.md).

Na preparação inicial não houve commit/push/deploy. Na continuidade de 27/10 o usuário autorizou a publicação: o serviço existente `SistemNF-e` em `https://sistemnf-e.onrender.com` foi confirmado no plano Free e recebeu os comandos/variáveis privados acima. O primeiro gestor da empresa foi preparado explicitamente; a senha inicial fica somente no arquivo privado local entregue ao usuário. Resultado da publicação e validação em HTTPS no [registro da etapa](../docs/13-backend-primeiro-recorte.md). O build antigo mostrado no erro não continha `/operacao/` nem `/acessos/`; ambas precisam aparecer no build publicado. Em outra instalação, credenciais e banco não são enviados automaticamente do computador para o Render.

Backend Node.js/TypeScript com Fastify, Better Auth e PostgreSQL. Fornece sessão real, vínculos e autorização por empresa, clientes, produtos, estoque, vendas, OS e compras, com versões e auditoria transacional. A área conectada Next.js está em `/operacao/`; a demonstração local continua independente.

Estado/testes e limites em [Primeiro recorte do backend](../docs/13-backend-primeiro-recorte.md), [Acessos e operação conectada](../docs/15-auditoria-acessos-e-filtros.md) e [Primeiro recorte financeiro](../docs/11-financeiro-primeiro-recorte.md). O painel `/acessos/` administra funcionários e permissões dos módulos conectados. Iniciar esta API não migra os dados da demonstração. O recorte financeiro conectado inclui acordos, parcelas, recebimentos manuais e caixa mínimo; emissão fiscal, séries individuais e peças/orçamento versionado de OS continuam pendentes.

## Desenvolvimento local no Windows

Use uma versão Node.js compatível com `engines` do manifesto. Em `D:\SistemNF-e\web\server`:

```powershell
npm.cmd install
npm.cmd run db:local
```

Esse terminal mantém somente o cluster da pasta `.local/development`, escutando em loopback. Ctrl+C encerra a instância que o comando iniciou, preservando seus dados. Não é serviço do Windows nem configuração global de PostgreSQL.

Em outro PowerShell, no mesmo diretório, informe o primeiro gestor explicitamente. Não grave sua senha no histórico do terminal:

```powershell
$env:SISTEM_OWNER_NAME = Read-Host "Nome do gestor"
$env:SISTEM_OWNER_EMAIL = Read-Host "E-mail do gestor"
$env:SISTEM_COMPANY_NAME = Read-Host "Nome da empresa"
$setupOwnerSecret = Read-Host "Senha do gestor (mínimo 12 caracteres)" -AsSecureString
try {
  $env:SISTEM_OWNER_PASSWORD = [System.Net.NetworkCredential]::new("", $setupOwnerSecret).Password
  npm.cmd run setup:local
} finally {
  Remove-Item -LiteralPath Env:SISTEM_OWNER_PASSWORD -ErrorAction SilentlyContinue
  $setupOwnerSecret.Dispose()
}
npm.cmd run dev
```

`setup:local` verifica se a conexão pertence ao diretório informado antes de alterar bancos. Prepara o banco central e um operacional, aplica migrações com credencial administrativa e gera `.local/development/api.env` com conexões de runtime. Os arquivos privados e credenciais de infraestrutura ficam ignorados pelo Git; a senha do gestor é processada pela biblioteca e não vai para esses arquivos nem para stdout.

Repetir a preparação preserva IDs, dados e senha anterior; informar outra senha não redefine a conta. Conta existente sem vínculo de gestor ativo é recusada, sem promoção ou reativação automática. Uma interrupção entre criar a identidade pela biblioteca e confirmar empresa/vínculo pode deixar identidade sem vínculo: o fluxo recusa promoção automática; sua recuperação administrativa precisa ser explícita. Não apagar contas como compensação sem verificar sua origem e uso.

A API usa `http://127.0.0.1:4000`, com origem de frontend explícita `http://127.0.0.1:3000`. Os scripts leem o arquivo gerado e, se existir, `.env` privado como configuração explícita adicional. O ambiente do processo tem precedência. `.env.example` não contém segredos ou credenciais padrão. Para outra infraestrutura use conexões/configuração explícitas e credencial de migração separada; não execute as ferramentas locais contra bancos de produção.

## Rotas deste recorte

- `/health/live` e `/health/ready`.
- `POST /api/auth/sign-in/email` e `POST /api/auth/sign-out`; signup e demais endpoints de autenticação não são públicos.
- `GET /api/v1/me`: identidade e empresas autorizadas, sem token ou conexão de banco no DTO.
- `GET/POST /api/v1/tenants/:tenantId/customers` e `GET/PATCH /api/v1/tenants/:tenantId/customers/:id`.
- `GET /api/v1/tenants/:tenantId/access-options`, `GET/POST .../members`, `PATCH .../members/:userId` e `GET .../access-audit`: administração da equipe exclusiva do gestor.
- `GET /api/v1/tenants/:tenantId/operations/:resource`, com produtos, estoque, vendas, OS, compras e técnicos; filtros/paginação no PostgreSQL.
- `POST .../operations/commands`, `POST .../operations/purchase-plan` e `GET .../operations/history`: comandos tipados, plano autoritativo de XML e histórico com autor/instante/antes/depois. Contratos completos no documento 15.

Mutações exigem sessão quando aplicável e `Origin` permitido, inclusive login/logout. Cookies são `HttpOnly`, `SameSite=Lax` e `Secure` fora do desenvolvimento HTTP em loopback. Vínculos e permissões são revalidados por requisição; por padrão `owner`/`operator` escrevem clientes e `viewer` consulta. O gestor personaliza ações de clientes e os direitos operacionais para atendimento/consulta; administração de equipe permanece exclusiva dos gestores. Pesquisa textual é literal e paginada. Alteração exige versão; inativação preserva o registro. A última conta de gestor ativo é protegida inclusive na concorrência.

O frontend utiliza a API loopback automaticamente somente quando ele próprio é aberto no loopback. Para outro endereço, configure `NEXT_PUBLIC_API_URL` antes de iniciar/buildar o frontend e a origem correspondente em `FRONTEND_ORIGIN`; esse valor público é somente a origem da API, nunca segredo. Fora do ambiente local a origem precisa de HTTPS. A infraestrutura deve manter frontend/API no mesmo site para o cookie `SameSite=Lax` funcionar; não enviar credenciais para um backend configurado por campo da tela ou parâmetro da URL. A tela `/acessos/` não redireciona o protótipo para o banco.

O cadastro de funcionário usa uma intenção com UUID estável, autor e conteúdo de negócio, sem senha persistida. Better Auth cria a identidade e uma chave interna prova sua origem; vínculo e auditoria administrativa confirmam juntos. Se houver falha após criar a identidade, repetir a mesma tentativa recupera o vínculo sem duplicar ou alterar a senha. Uma conta preexistente não é incorporada automaticamente. Fechar o formulário descarta a tentativa em memória; recuperação administrativa de uma intenção abandonada e fluxo de convite/recuperação de senha continuam pendentes. Não editar tabelas de identidade manualmente para contornar um conflito.

Cadastro e auditoria confirmam juntos no banco da empresa. Autor, empresa, versões e instantes vêm do servidor; nenhum formulário pode forjá-los. PATCH sem alteração efetiva não muda versão/data nem cria evento. Erros/logs são projetados sem body, query, cookies, conexão ou erro bruto. Isso não conclui auditoria e permissões de todos os módulos.

## Verificação e build

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd start
```

Os testes usam somente clusters isolados em `.local/tests` e dados fictícios, encerrando as instâncias que iniciam. Não usar dados reais nessas fixtures. O reporter de teste preserva resultados/exit code sem imprimir corpos de asserção ou credenciais. O build do servidor gera `dist`; inclua também `web/shared/purchase-planner.mjs` na distribuição, preservando a relação `server/dist` → `shared`. O planejador puro é compartilhado com a demonstração, sem importar o armazenamento local. O build Next.js continua separado na pasta pai.

`tenant_002` acrescenta registros operacionais, saldos, movimentos, tentativas idempotentes e valores de auditoria, sem reescrever clientes ou `tenant_001`. Migrações são explícitas nas ferramentas de preparação, nunca executadas por uma requisição HTTP. Instâncias já preparadas precisam reaplicar `setup:local` com os dados explícitos do mesmo gestor para receber a nova migração; não apague bancos para atualizar.

Há 19 direitos operacionais adicionais. Gestores recebem o catálogo completo; funcionários existentes mantêm suas concessões anteriores até configuração explícita. O painel oferece **Aplicar rotina de balcão**, sem conceder custos ou compras. A API valida dependências entre direitos e revalida o vínculo em cada chamada. Criação de cliente aceita `requestId` opcional para recuperar a mesma tentativa no cadastro contextual sem duplicar registros.

Esta preparação não publica serviço, configura HTTPS/rede, envia convites, migra localStorage ou cria usuários com credenciais reais fornecidas por terceiros. Acesso de outros computadores exige infraestrutura e configuração apropriadas; loopback é apenas o ambiente local de desenvolvimento.

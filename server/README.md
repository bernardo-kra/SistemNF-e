# Sistem API

Backend Node.js/TypeScript com Fastify, Better Auth e PostgreSQL. Fornece sessão real, vínculos e autorização por empresa, clientes, produtos, estoque, vendas, OS e compras, com versões e auditoria transacional. A área conectada Next.js está em `/operacao/`; a demonstração local continua independente.

Estado/testes e limites em [Primeiro recorte do backend](../docs/13-backend-primeiro-recorte.md) e [Acessos e operação conectada](../docs/15-auditoria-acessos-e-filtros.md). O painel `/acessos/` administra funcionários e permissões dos módulos conectados. Iniciar esta API não migra os dados da demonstração. Financeiro, caixa, emissão fiscal, séries individuais e peças/orçamento versionado de OS continuam fora desta integração.

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

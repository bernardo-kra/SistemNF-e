# Sistem — protótipo navegável

Next.js 16.4.2, React 19.3.1, TypeScript e CSS. Interface em português para uma loja de eletrônicos com assistência técnica.

## Executar no Windows / PowerShell

Na pasta `D:\SistemNF-e\web`:

```powershell
npm.cmd install
npm.cmd run dev
```

Abrir `http://127.0.0.1:3000`. O sufixo `.cmd` evita o bloqueio de `npm.ps1` pela política do PowerShell, sem alterar a configuração do computador. Em outros shells, `npm install` e `npm run dev` funcionam normalmente.

## Verificações

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Os testes de navegador usam Google Chrome instalado (`channel: chrome`). O Playwright inicia o servidor quando necessário. O build gera a versão estática em `out/`; `next start` não se aplica ao modo de exportação estática.

O comando de build também executa `postbuild`, que adiciona nomes portáveis aos arquivos de segmentos exportados incorretamente em builds Windows. A correção é local aos artefatos, preserva os originais e foi motivada por um [problema reproduzido e registrado no Next.js](https://github.com/vercel/next.js/issues/92339). Há três testes dessa normalização em `checks/`, incluídos em `npm.cmd test`. Remover a correção somente após verificar uma versão do Next que exporte os caminhos corretamente.

## Funcionalidades demonstráveis

- Painel com indicadores calculados a partir dos registros.
- Clientes e produtos: busca, filtros, criação e edição.
- OS: entrada, diagnóstico e valores, aprovação registrada, execução, checklist e entrega. Histórico com responsável pela aprovação/retirada.
- Financeiro: recebimentos manuais parciais/totais de OS aprovadas; forma e valor registrados no histórico.
- Produtos/estoque: catálogo separado do saldo, entrada manual com referência e reserva/saída por venda.
- Vendas: um item por pedido, reserva por quantidade e entrega de produtos sem controle por série.
- Importação: exemplo pronto e leitura de XML no navegador, vínculos por item, preço de venda, revisão e bloqueio de documento repetido. Novos produtos entram com estoque zero.
- Área fiscal: configuração do emitente, revisão de produtos/serviço e dados fiscais do cliente. Preparação vinculada à venda ou OS, cópia dos dados, fila, rejeição/nova tentativa, resultado desconhecido/consulta e cancelamento simulados; sem emissão ou consulta reais.
- Configurações: exportação JSON e restauração dos exemplos com confirmação.
- Busca global, navegação responsiva, modais nativos e acesso demonstrativo em `/entrar/`.

## Dados e limites

Usar apenas informações fictícias. O armazenamento é local ao navegador e não oferece autenticação, isolamento real de empresas, sincronização entre computadores ou backup. Os contatos de parceiros adicionados ficam somente na sessão da tela, conforme aviso nela.

Não há OCR, banco de dados, envio de mensagens, transação bancária, emissão fiscal ou cobrança de assinatura. O parser XML é uma demonstração de preenchimento: não valida assinatura, autorização ou destinatário e não deve ser usado para efetivar compras reais. Seleções de vínculo a produtos existentes ainda não criam um cadastro completo de relações entre fornecedores e produtos.

OS não baixa peças do estoque nesta etapa. A NFS-e simulada considera somente o serviço e destaca as peças excluídas; a operação de mercadorias das peças continua pendente. Produtos serializados aparecem no catálogo e no pedido demonstrativo, mas conferência e venda de séries individuais ainda não estão implementadas; a entrega desse pedido está desabilitada. Os dados fiscais de exemplo não representam orientação tributária.

O estado local foi atualizado para a versão 2, preservando a chave de armazenamento e migrando registros válidos da versão 1. Códigos declarados têm conferência de formato; CPF/CNPJ também têm conferência dos dígitos, incluindo CNPJ alfanumérico, sem consulta cadastral. Não há cálculo tributário. O bloqueio de documento duplicado é local, sem garantias de concorrência entre abas/computadores.

O [plano executado e os próximos passos](docs/08-etapa-fiscal-e-proximos-passos.md) descrevem as regras da simulação, os contratos propostos e a sequência até o piloto fiscal real.

O [desenho financeiro ampliado](docs/09-financeiro-pagamentos-e-fluxo-de-caixa.md) especifica entrada/parcelas, pagamento mensal na loja, dinheiro/troco, Pix, cartão e repasse, cheque/compensação, pagamento misto, contas a pagar, caixa e conciliação. É uma especificação futura: essas funcionalidades não foram adicionadas à tela nesta revisão. `OS.received` continua sendo um valor acumulado demonstrativo, insuficiente para calcular saldo bancário ou caixa histórico. O plano define a substituição por registros próprios e a preservação dos valores legados sem inventar movimentos.

A referência de data da demonstração é 16/10/2026, para manter exemplos e testes reproduzíveis.

## Organização

A [equipe de agentes](docs/10-equipe-de-agentes.md) define os papeis de analista, desenvolvedor e QA. Os perfis do Codex ficam em `.codex/agents` e herdam as configuracoes da sessao.

- `src/app`: rotas Next.js, estilos globais e tokens locais do design system.
- `src/components`: estrutura visual e componentes compartilhados.
- `src/features`: telas e interações por domínio.
- `src/lib/domain.ts`: tipos, etapas e formatação; valores monetários em centavos nesta simulação.
- `src/lib/seed.ts`: registros fictícios.
- `src/lib/demo-store.tsx`: operações e persistência simuladas. Na integração real, substituir por serviços HTTP preservando contratos, autorização e validações no servidor.
- `src/lib/fiscal`: tipos, conferência estrutural, transições e adaptador exclusivamente simulado.
- `src/lib/demo-persistence.ts`: restauração e migração dos dados locais.
- `tests`: jornadas de navegador com foco em persistência, estados, estoque e importação.

Os tokens foram copiados da especificação em `../design/tokens.css` para manter este aplicativo independente na publicação. Mudanças futuras no design system devem sincronizar os dois arquivos.

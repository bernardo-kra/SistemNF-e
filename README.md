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
- Financeiro: acordo por venda confirmada/OS aprovada, entrada e parcelas com valores exatos e vencimentos próprios/editáveis, recebimento parcial em dinheiro/Pix/transferência e recibos preservados. Dinheiro exige turno, com abertura dentro do recebimento sem perder os dados preenchidos; abrir não baixa a parcela. Pix/transferência exigem conferência manual identificada.
- Caixa e contas: duas contas fictícias com saldo inicial zero, abertura/fechamento de turno com contagem/diferença, novos movimentos de entrada e histórico de recebimentos. Não há integração bancária ou fluxo de caixa completo.
- Relatórios: recebimentos, parcelas com data-base, vendas e OS, com filtros por período/consumidor, meios e contas quando aplicáveis, totais e exportação CSV da seleção. Valores comerciais, recebimentos e legado de OS aparecem separados.
- Diagnóstico: ocorrências automáticas de comandos rejeitados, armazenamento e erros globais, com código para suporte, filtros e exportação JSON. Histórico independente com até 200 eventos e descarte de mensagens brutas, parâmetros de URL e dados dos cadastros.
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

O estado local está na versão 3, mantendo a chave de armazenamento e migrando registros válidos das versões 1 e 2. Recebimentos antigos das OS são preservados como histórico informado; não geram movimentos com conta/data inventadas. Falha na recuperação preserva o arquivo original e bloqueia gravação até uma ação explícita; Configurações oferece exportação do arquivo original. Códigos fiscais declarados têm conferência de formato; CPF/CNPJ também têm conferência dos dígitos, incluindo CNPJ alfanumérico, sem consulta cadastral. Não há cálculo tributário. Bloqueios locais não garantem concorrência entre abas/computadores ou isolamento de servidor.

O [plano executado e os próximos passos](docs/08-etapa-fiscal-e-proximos-passos.md) descrevem as regras da simulação, os contratos propostos e a sequência até o piloto fiscal real.

O [desenho financeiro ampliado](docs/09-financeiro-pagamentos-e-fluxo-de-caixa.md) continua como direção do módulo completo. O [primeiro recorte implementado pela equipe](docs/11-financeiro-primeiro-recorte.md) entrega acordos, parcelas, recebimentos manuais, recibos e turno mínimo. Cartão, cheque, pagamento misto numa mesma baixa, contas a pagar, conciliação bancária, juros, renegociação, estorno e reembolso continuam pendentes. Os novos registros são próprios, sem reescrever `OS.received`; resumos de OS somam histórico informado e novas alocações uma única vez. Sem estorno, use somente dados fictícios e confira antes de confirmar.

A referência operacional dos exemplos permanece em 16/10/2026. O financeiro usa a data atual e o instante real do registro, com dia civil em `America/Sao_Paulo`; o usuário escolhe os vencimentos, mas não retrodata recebimentos. A previsão contempla só parcelas de acordos confirmados, separando vencidos; não é saldo bancário real nem projeção completa de caixa.

Em **Diagnóstico**, copie o código mostrado na notificação de falha, filtre a ocorrência e use **Exportar diagnóstico** para obter o JSON de suporte. A chave `sistem:diagnostics:v1` é separada dos dados operacionais; se a gravação falhar, o histórico fica somente em memória. Não há envio automático, painel central de suporte ou identidade autenticada de empresa: o identificador é desta instalação local. Em **Relatórios**, escolha o tipo e o período e use **Exportar CSV**; somente Parcelas permite calcular saldo numa data-base histórica. OS e vendas mostram a situação atual. Decisões, testes e limites estão em [Diagnóstico e relatórios](docs/12-logs-e-relatorios.md).

## Organização

A [equipe de agentes](docs/10-equipe-de-agentes.md) define sete papéis: orquestrador, analista, arquiteto, desenvolvedor, QA e Segurança, revisor e especialista sob demanda. O agente principal coordena e seleciona os papéis necessários, sem iniciar todos por rotina. O guia inclui contratos de delegação/entrega, limites de autonomia e critérios para reduzir digitação repetida, trocas de tela e lançamentos manuais evitáveis. Os perfis do Codex ficam em `.codex/agents` e herdam as configurações da sessão. Alterar essas instruções não implementa as melhorias propostas para o balcão.

- `src/app`: rotas Next.js, estilos globais e tokens locais do design system.
- `src/components`: estrutura visual e componentes compartilhados.
- `src/features`: telas e interações por domínio.
- `src/lib/domain.ts`: tipos, etapas e formatação; valores monetários em centavos nesta simulação.
- `src/lib/seed.ts`: registros fictícios.
- `src/lib/demo-store.tsx`: operações e persistência simuladas. Na integração real, substituir por serviços HTTP preservando contratos, autorização e validações no servidor.
- `src/lib/fiscal`: tipos, conferência estrutural, transições e adaptador exclusivamente simulado.
- `src/lib/finance`: tipos, regras e validação dos registros financeiros locais; o servidor continua pendente.
- `src/lib/diagnostics`: catálogo controlado, projeção dos eventos, filtros e buffer local independente.
- `src/lib/reports`: consultas puras, totais em centavos e CSV dos registros selecionados.
- `src/lib/demo-persistence.ts`: restauração e migração dos dados locais.
- `tests`: jornadas de navegador com foco em persistência, estados, estoque e importação.

Os tokens foram copiados da especificação em `../design/tokens.css` para manter este aplicativo independente na publicação. Mudanças futuras no design system devem sincronizar os dois arquivos.

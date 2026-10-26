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
- OS: entrada, diagnóstico e valores, aprovação registrada, execução, checklist e entrega. Salvar e imprimir gera comprovante preenchido com Code 128, documento do cliente mascarado e referência estável; reimpressão não cria outra OS. O leitor de teclado ativado no balcão abre diretamente a ordem e suas ações, com histórico de aprovação/retirada.
- Cadastros no contexto: criar cliente e técnico durante a OS, cliente e produto durante a venda, mantendo o formulário preenchido e selecionando o registro salvo. Categoria aceita texto novo e sugere as existentes. Técnicos são cadastros operacionais locais, sem conta de acesso.
- Financeiro: acordo por venda confirmada/OS aprovada, entrada e parcelas com valores exatos e vencimentos próprios/editáveis, recebimento parcial em dinheiro/Pix/transferência e recibos preservados. Dinheiro exige turno, com abertura dentro do recebimento sem perder os dados preenchidos; abrir não baixa a parcela. Pix/transferência exigem conferência manual identificada.
- Caixa e contas: duas contas fictícias com saldo inicial zero, abertura/fechamento de turno com contagem/diferença, novos movimentos de entrada e histórico de recebimentos. Não há integração bancária ou fluxo de caixa completo.
- Relatórios: recebimentos, parcelas com data-base, vendas e OS, com filtros por período/consumidor, meios e contas quando aplicáveis, totais e exportação CSV da seleção. Valores comerciais, recebimentos e legado de OS aparecem separados.
- Diagnóstico: ocorrências automáticas de comandos rejeitados, armazenamento e erros globais, com código para suporte, filtros e exportação JSON. Histórico independente com até 200 eventos e descarte de mensagens brutas, parâmetros de URL e dados dos cadastros.
- Produtos/estoque: catálogo separado do saldo, preço de compra e venda visíveis na lista, lucro estimado por unidade e margem sobre a venda calculados enquanto os preços são editados. Entrada manual com referência e reserva/saída por venda.
- Preços em lote: em Produtos, defina um acréscimo sobre a compra para todos os preços pendentes, confira lucro/margem e salve uma vez. Valores manuais são exceções preservadas; incluir produtos já precificados exige escolha explícita. Na venda, preço pendente pode ser resolvido no próprio contexto sem perder o pedido.
- Vendas: carrinho com vários produtos, cliente escolhido uma vez, quantidades/subtotais/total e uma confirmação para reservar o conjunto. Produtos repetidos são agrupados; itens podem ser removidos. Entrega deduz físico e libera reservas uma vez, para produtos sem controle por série.
- Produto cadastrado durante a venda começa com estoque zero. A entrada manual pode ser registrada no mesmo fluxo, com quantidade e referência conferidas; entrada e confirmação da venda continuam separadas.
- Importação XML em uma página: vínculos de vários fornecedores para o mesmo SKU, sugestões locais de nome/atributos, novos cadastros em lote e decisões apenas sobre ambiguidades. Somente cadastrar mantém estoque zero; Registrar recebimento confirma quantidades e conversões, com parciais e proteção contra repetição. Novos produtos sem preço ficam pendentes e não podem ser vendidos até sua definição.
- Área fiscal: configuração do emitente, revisão de produtos/serviço e dados fiscais do cliente. Preparação vinculada à venda ou OS, cópia dos dados, fila, rejeição/nova tentativa, resultado desconhecido/consulta e cancelamento simulados; sem emissão ou consulta reais.
- Configurações: exportação JSON e restauração dos exemplos com confirmação.
- Busca global, navegação responsiva, modais nativos e acesso demonstrativo em `/entrar/`.

## Dados e limites

Usar apenas informações fictícias. O armazenamento é local ao navegador e não oferece autenticação, isolamento real de empresas, sincronização entre computadores ou backup. Os contatos de parceiros adicionados ficam somente na sessão da tela, conforme aviso nela.

Não há PDF/OCR, IA externa, banco operacional, envio de mensagens, transação bancária, emissão fiscal ou cobrança de assinatura. O parser XML não valida assinatura, autorização ou destinatário e não deve ser usado para efetivar compras reais. Os vínculos e recebimentos agora são persistidos na extensão local `purchasing`; a compra mantém financeiro pendente, sem gerar obrigação a pagar, vencimento, pagamento ou caixa. Quantidades e conversões fracionárias, séries e distribuição de cores sortidas não são recebidas neste recorte. O parser concilia apenas os componentes de total reconhecidos; divergências ficam bloqueadas.

Na OS, use **Salvar e imprimir** na abertura ou **Imprimir comprovante** no detalhe. A folha não inclui senha de desbloqueio; não há cofre de senhas implementado. Em Ordens de serviço, **Ativar leitor de OS** prepara o balcão para receber a referência `SISTEM-OS:<id>` seguida de Enter. A captura fica suspensa durante edição e comprovante, preservando o rascunho. A retirada própria é uma ação direta; outra pessoa abre a exceção. Saldo pendente exige aceite explícito apenas para o ensaio local, sem representar permissão comercial real ou quitação. Aprovação e testes continuam obrigatórios para entrega. Barcode e teclado são verificáveis no navegador; impressora e leitor físicos precisam de validação com o hardware adotado.

Confirmação de compra, salvamento de OS, avanço de etapa, cadastro individual de produto, precificação em lote, confirmação de venda e entrega gravam antes de anunciar sucesso, sem alterar o estado operacional quando a gravação é recusada. Os demais comandos antigos ainda mantêm sua estratégia anterior de persistência; isso não representa transação de servidor ou coordenação entre abas. O comprovante usa um instantâneo dos dados existentes, sem implementar orçamento versionado, autenticação ou acesso público de acompanhamento.

OS não baixa peças do estoque nesta etapa. A NFS-e simulada considera somente o serviço e destaca as peças excluídas; a operação de mercadorias das peças continua pendente. Produtos serializados aparecem no catálogo e no pedido demonstrativo, mas conferência e venda de séries individuais ainda não estão implementadas; a entrega desse pedido está desabilitada. Os dados fiscais de exemplo não representam orientação tributária.

O estado local está na versão 3, mantendo a chave de armazenamento e migrando registros válidos das versões 1 e 2. Recebimentos antigos das OS são preservados como histórico informado; não geram movimentos com conta/data inventadas. Falha na recuperação preserva o arquivo original e bloqueia gravação até uma ação explícita; Configurações oferece exportação do arquivo original. Códigos fiscais declarados têm conferência de formato; CPF/CNPJ também têm conferência dos dígitos, incluindo CNPJ alfanumérico, sem consulta cadastral. Não há cálculo tributário. Bloqueios locais não garantem concorrência entre abas/computadores ou isolamento de servidor.

O [cadastro no contexto](docs/14-cadastros-no-contexto.md) usa o mesmo cadastro das telas de Clientes/Produtos. Cancelar a etapa auxiliar mantém a seleção e o rascunho principal; salvar o cadastro é uma confirmação própria e o registro continua existindo se a OS/venda for cancelada depois. A extensão opcional de técnicos mantém a versão local 3 e incorpora nomes das OS antigas sem reescrever históricos. O painel usa esse catálogo; não há criação de senha, usuário autenticado ou permissão por esse cadastro.

Em Produtos, o preço de compra é a referência por unidade já cadastrada (`cost`); não é custo médio nem atualização automática pela última compra. Lucro estimado = venda menos compra, antes de impostos, taxas e outras despesas; a margem divide essa diferença pela venda. Valores pendentes/vazios não geram estimativa, e venda zero não gera percentual. Editar os preços do catálogo preserva os valores das operações anteriores; não calcula lucro contábil nos relatórios.

**Definir preços em lote** usa todos os pendentes, independentemente dos filtros da lista. O acréscimo é escolhido pelo operador, sem política presumida: 50% sobre compra de R$ 20,00 sugere venda de R$ 30,00 e margem de 33,33%. Compra zero fica sem sugestão e exige preço manual ou exclusão do lote; zero de venda só é aplicado quando informado explicitamente nesse caso. Alterar o percentual preserva exceções manuais; `Usar percentual` restaura a sugestão da linha. O comando valida o conjunto e as referências antes de gravar. Repetição dos mesmos valores é inócua; mudanças detectadas de custo/preço/pendência exigem reabrir a prévia. Regras, testes e limites no [cadastro assistido da workspace](../docs/07-cadastro-assistido.md).

Em **Nova venda**, use **Adicionar produto** para outra linha e ajuste a quantidade diretamente no carrinho; não há salvamento por item. Cadastro de produto, definição de preço e entrada manual atuam na linha acionadora e preservam os demais itens. Confirmar reserva tudo ou recusa o conjunto. A tentativa mantém o mesmo ID após falha de gravação; repetir o mesmo conteúdo não duplica venda/reserva, e outro conteúdo com ID já usado é recusado. A entrega revalida físico e reservas antes das baixas e sua repetição é inócua. Preços confirmados permanecem copiados no pedido. Detalhamento em [Fluxo da venda na workspace](../docs/02-fluxos-e-requisitos.md).

O [plano executado e os próximos passos](docs/08-etapa-fiscal-e-proximos-passos.md) descrevem as regras da simulação, os contratos propostos e a sequência até o piloto fiscal real.

O [desenho financeiro ampliado](docs/09-financeiro-pagamentos-e-fluxo-de-caixa.md) continua como direção do módulo completo. O [primeiro recorte implementado pela equipe](docs/11-financeiro-primeiro-recorte.md) entrega acordos, parcelas, recebimentos manuais, recibos e turno mínimo. Cartão, cheque, pagamento misto numa mesma baixa, contas a pagar, conciliação bancária, juros, renegociação, estorno e reembolso continuam pendentes. Os novos registros são próprios, sem reescrever `OS.received`; resumos de OS somam histórico informado e novas alocações uma única vez. Sem estorno, use somente dados fictícios e confira antes de confirmar.

A referência operacional dos exemplos permanece em 16/10/2026. O financeiro usa a data atual e o instante real do registro, com dia civil em `America/Sao_Paulo`; o usuário escolhe os vencimentos, mas não retrodata recebimentos. A previsão contempla só parcelas de acordos confirmados, separando vencidos; não é saldo bancário real nem projeção completa de caixa.

Em **Diagnóstico**, copie o código mostrado na notificação de falha, filtre a ocorrência e use **Exportar diagnóstico** para obter o JSON de suporte. A chave `sistem:diagnostics:v1` é separada dos dados operacionais; se a gravação falhar, o histórico fica somente em memória. Não há envio automático, painel central de suporte ou identidade autenticada de empresa: o identificador é desta instalação local. Em **Relatórios**, escolha o tipo e o período e use **Exportar CSV**; somente Parcelas permite calcular saldo numa data-base histórica. OS e vendas mostram a situação atual. Decisões, testes e limites estão em [Diagnóstico e relatórios](docs/12-logs-e-relatorios.md).

## Backend em desenvolvimento local

O [primeiro recorte do backend](docs/13-backend-primeiro-recorte.md) implementa API Node.js, login por cookie, vínculos e autorização por empresa, PostgreSQL central/operacional separado e cadastro de clientes com versão concorrente e auditoria transacional. As ferramentas locais preparam bancos e o primeiro gestor mediante credenciais explícitas; instruções em [server/README.md](server/README.md).

As telas demonstrativas acima continuam locais. A área **Operação conectada**, em `/operacao/`, usa o backend para produtos, estoque, vendas, OS e compras, com histórico de autor/horário, filtros e permissões por ação. **Equipe e acessos**, em `/acessos/`, administra os funcionários e seus direitos. Ambas são acessíveis pelas Configurações; usam a mesma sessão real e não leem o armazenamento da demonstração. Contratos, evidências e limites estão no [documento de acessos e operação](docs/15-auditoria-acessos-e-filtros.md).

O fluxo conectado recebe XML em lote, resolve vínculos conhecidos e solicita decisões nas ambiguidades; permite precificar pendentes em conjunto. Vendas reservam o carrinho e a entrega baixa o físico uma vez. OS permite cadastrar cliente/técnico durante a abertura, avançar etapas e registrar entrega com conferência financeira explicitamente não integrada. Histórico mostra antes/depois e identidade real; custo é retirado do payload sem a permissão correspondente. A API valida permissões, versões e saldo.

Esse recorte não migra dados locais nem reproduz ainda todas as funcionalidades demonstrativas: financeiro/relatórios, caixa, fiscal, impressão/leitor de OS, peças/orçamento versionado e séries individuais continuam fora da área conectada. Um novo banco começa vazio. Não houve publicação ou migração de dados reais. Para usar entre computadores, ainda é necessário configurar infraestrutura, HTTPS e origem da API conforme o guia do servidor.

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
- `src/lib/purchases`: extração local de identidade, leitura XML, propostas, vínculos, compras e recebimentos rastreáveis.
- `src/lib/catalog-pricing.ts`: sugestão por acréscimo e validação do conjunto de preços, sem alterar estoque ou operações anteriores.
- `src/lib/sales-engine.ts` e `src/components/sale-editor.tsx`: carrinho, confirmação/reserva e entrega do conjunto, com proteção contra repetição e gravação recusada.
- `src/lib/order-code.ts` e `src/components/order-receipt.tsx`: referência de leitura e comprovante com Code 128 em SVG local.
- `src/lib/demo-persistence.ts`: restauração e migração dos dados locais.
- `tests`: jornadas de navegador com foco em persistência, estados, estoque e importação.

Os tokens foram copiados da especificação em `../design/tokens.css` para manter este aplicativo independente na publicação. Mudanças futuras no design system devem sincronizar os dois arquivos.

# Diagnóstico e relatórios da loja

## REL-PAR — parcelas na data-base — 06/11/2026

Aceite definido antes das fontes: relatório conectado, somente leitura sob `finance.read` e vínculo físico da empresa. Seleção pelo vencimento inclusivo `from/to`, busca literal pelo nome histórico do acordo, `asOf` civil obrigatório e situação `all|open|overdue|paid`. Considerar somente acordos/parcelas criados até o fim da data-base em São Paulo. Somar apenas alocações cujo pagamento ocorreu até esse mesmo limite; pagamento no dia seguinte não reduz o saldo histórico. Vencida exige saldo positivo e vencimento anterior à data-base; vencimento no próprio dia fica em aberto; quitada exige saldo zero. Não deduzir saldo de preço atual, legado de OS, data da venda, dinheiro em caixa ou pagamentos sem alocação. Não inferir dívida de orçamento sem acordo. Valores negativos/overpayment ou somas inseguras falham sem gerar crédito implícito.

Uma linha por parcela, com origem, entrada/parcela e nome preservados no acordo. Totais de principal/pago/saldo/vencido e quantidade sobre toda a seleção filtrada, páginas até 100 e CSV integral até 10 mil linhas, sem truncamento. Cada consulta/exportação usa uma transação de leitura consistente. Reutilizar validação/transação/paginação de relatórios quando houver duplicação concreta; preservar o contrato de recebimentos.

Quem usa é o gestor/funcionário com consulta financeira. Escolher “Parcelas” na mesma página faz uma consulta com mês/data-base atuais, sem nova navegação/cadastro/consulta de clientes. Edição não dispara rede por tecla; uma ação aplica todos os filtros; páginas/exportação usam a seleção aplicada. Data-base só aparece para parcelas. Troca de tipo/empresa cancela e ignora respostas antigas, inclusive erros de autorização/exportações; não transfere filtros incompatíveis. Campos editados/erros não viram zero, e CSV bloqueia até aplicar os filtros. Conferir API/PostgreSQL, fronteiras de dia, acordo futuro, pagamentos parciais/em vários momentos, duplicação, isolamento/revogação/exportação, 320/1440px, CSV e integração real compilada. Não publicar, migrar banco remoto, acessar registros reais ou executar operação bancária/fiscal nesta etapa.

**Entrega: concluída localmente neste recorte; não publicada.** `server/src/installment-reports.ts`, duas rotas autenticadas, contrato compartilhado e opção Parcelas na página existente. Agregação das alocações por parcela antes de juntar às origens, limitada pelo instante do pagamento; acordo e parcela também precisam existir até o fim da base. Situação/totais são derivados desse saldo. `open` inclui todos os saldos positivos, inclusive vencidos, mantendo o comportamento do financeiro conectado; a opção explicita isso. Inconsistência negativa é verificada antes do filtro de situação, para não desaparecer numa consulta por quitadas. Não introduz lançamento, crédito, juros ou obrigação a partir de legado/orçamento. CSV identifica data-base, filtro, geração, valores e origem.

**Simplificação:** `report-query.ts` concentra apenas o que passou a ter dois consumidores reais: datas/busca, limites de página/exportação, transação consistente, autorização financeira e vínculo do banco. Recebimentos conserva o contrato e seus testes. A interface usa o mesmo controlador de consulta/cancelamento/exportação com tipos distintos; pequenas funções de CSV/tabela tratam as diferenças. A troca de tipo remonta o conteúdo e cancela operações antigas, sem criar um hook/framework genérico ou duplicar toda a tela. Sem migração ou dependência nova.

**Evidências:** primeira rodada API teve dois RED HTTP404 e três erros da fixture por omitir `created_at` da conta; correção apenas dos dados genéricos obrigatórios, sem mudar expectativas. Segunda rodada anterior às fontes: cinco falhas com rotas inexistentes (um cenário tentou ler totais da resposta de erro). Primeiro RED da UI: seletor de tipo inexistente; três casos seguintes não executados naquela rodada. Depois da implementação, **10/10** backend (cinco parcelas + cinco recebimentos) e **10/10** UI específicos passaram. Complementos de fronteira conferem separadamente criação futura do acordo/parcela e `open` incluindo vencidas, sem atribuir RED a esses complementos. Rodada final backend **40/40** (35 financeiro + cinco parcelas), sem falhas/ignorados: **45 cenários backend únicos em rodadas**. Rodada única frontend **40/40** (quatro parcelas + seis recebimentos + nove motor/CSV + quatro demonstração + 17 navegação). Seis checks Node, tipos API/web e build Next/API/36 aliases passaram; não há linter configurado. Não equivale a repetir toda a suite do produto.

**Integração real:** ensaio explícito ampliado em `server/test/receipt-report-browser-smoke.ts` executou Chrome → aplicação estática/API compilada → Better Auth → PostgreSQL genérico isolado, sem interceptações. Venda fictícia de R$10, duas parcelas, pagamento de R$7,50 abatendo ambas: relatório mostra R$10 principal, R$7,50 pago, R$2,50 saldo, uma parcela quitada e outra aberta. Consulta/exportação de recebimentos anterior preservadas; Parcelas realizou uma consulta ao trocar o tipo, outra ao aplicar o período de vencimento futuro e uma exportação integral. Sem ação por parcela, sem recadastrar cliente e sem mutação de auditoria. Resultado `success=true`, `cleanup=true`, `compiledApi=true`. Observações locais únicas: 226ms para abrir/mostrar recebimento e 72ms para aplicar o período de parcelas; não são SLO, teste de capacidade publicada ou produtividade humana. Capturas genéricas 320/1440px inspecionadas, controles dentro da largura e rolagem horizontal própria da tabela. Navegador, API e cluster do ensaio encerrados.

Coordenador definiu aceite, escreveu os testes antes do comportamento e implementou/validou; não há revisão independente atribuída a outro agente. Logs/capturas técnicos ignorados em `server/.local/validation/installment-report-*`. README, guia da API, RF-027 e backlog atualizados. Nenhum dado real/ambiente remoto, segredo, migração, commit, publicação ou operação bancária/fiscal alterado. **Próximo recorte: relatórios conectados de vendas e OS**, preservando a separação entre valor comercial, orçamento e recebimento; diagnóstico central, crédito e demais integrações seguem no backlog.

## REL-REC — recebimentos conectados — 06/11/2026

Recorte delimitado para esta etapa. Aceite antes do código: consultar pagamentos efetivamente registrados no banco da empresa, sob `finance.read`, sem depender da demonstração. Uma linha por pagamento, independentemente do número de parcelas abatidas; dinheiro líquido aplicado, sem somar troco, venda, promessa ou legado de OS. Data civil de São Paulo, intervalo inclusivo e datas estritas; busca literal pelo nome preservado no recibo e filtro de meio. Nomes de cliente, conta e responsável vêm do recibo, preservando o fato histórico. Paginação estável por instante/ID, totais de toda a seleção em uma transação de leitura consistente, sem mutações, e limite de 100 linhas por página. Exportação integral da seleção em uma consulta própria, limitada a 10 mil pagamentos: excesso exige refinar os filtros, nunca trunca silenciosamente. CSV neutraliza fórmulas e escapa aspas/separadores.

Quem consulta é o gestor ou funcionário com leitura financeira. O período inicial é o mês corrente; abrir a tela faz uma consulta, sem ação por pagamento nem consulta separada de clientes/contas. Alterar filtros preserva a edição e uma ação Consultar aplica o conjunto; navegar páginas faz uma consulta; exportar faz uma consulta da seleção aplicada. Não emitir solicitações por tecla. Loading/erro nunca significam saldo zero; filtros editados não podem exportar uma seleção antiga silenciosamente. Troca de empresa cancela/ignora respostas antigas. Conferir 320/1440px, permissões, zero dados, erros/retentativa, paginação, CSV e integração HTTP/PostgreSQL isolada. Sem migração remota, publicação, serviço fiscal/bancário externo ou dados reais. Parcelas, vendas e OS conectados permanecem próximos recortes.

**Entrega: concluída localmente neste recorte; não publicada.** API em `server/src/receipt-reports.ts`, contrato de tipos compartilhado, duas rotas de leitura e `/relatorios/` com sessão/empresa existentes. Sem migração ou dependência nova. Conta/autor/cliente vêm do recibo imutável; SQL parametrizado filtra por fronteiras locais de data e busca literal (`%`/`_` não são curingas). Uma transação de leitura consistente gera totais e página; um limite próprio impede exportação parcial. CSV compartilhado com o motor demonstrativo evita duplicar regras de escape/neutralização. A demonstração permanece independente. Relatórios saiu de “Em preparação” no menu local e respeita o direito financeiro no acesso direto. Exportação é uma fotografia nova do momento de baixar, podendo incluir recebimentos posteriores à consulta anterior; o CSV identifica geração/filtros/totais.

**Testes/evidências:** cinco novos cenários API/PostgreSQL isolado passaram: autorização/revogação/vínculo físico; datas de fronteira em São Paulo/nomes históricos/páginas; um pagamento rateado em duas parcelas sem duplicar ou alterar auditoria; filtros inválidos/indisponibilidade; exportação completa, limite e soma insegura. Mais **35/35** regressões financeiras passaram. Na interface, rodada pertinente de **35/35** (cinco novos + nove motor/CSV + quatro demonstração + 17 navegação), seguida de complemento de busca normalizada com RED válido e correção; seis novos cenários passaram na rodada final, incluindo 320/1440px. **36 cenários web únicos em rodadas**, sem atribuir regressão completa de toda a aplicação. Seis checks Node, tipos web/API e build Next/API/36 aliases passaram. Não há linter configurado.

Primeira rodada API falhou na própria fixture porque faltava `claimed_at` no vínculo obrigatório; corrigida sem mudar expectativas. Rodada seguinte, antes das fontes, teve cinco RED HTTP404. Navegador inicialmente excedeu o prazo de partida de 60s do Next; configuração técnica privada ampliou somente esse prazo para 180s. Primeiro RED funcional da UI: título/fluxo conectado ausente, demais casos não executados naquela rodada. Primeiro GREEN teve quatro falhas de teste: mock de exportação devolvia uma linha declarando 26 no total (produto recusou arquivo incompleto) e seletores de alerta abrangiam também o anunciador do Next. Mock passou a representar 25+1 linhas/página e 26 na exportação; alertas foram delimitados ao conteúdo principal, preservando expectativas de negócio. UNI11 deixou de exigir placeholder de Relatórios conforme o requisito novo; continua verificando Parceiros sem dados fictícios. O complemento de espaços na busca reproduziu exportação bloqueada por divergência de filtros e passou ao refletir a normalização devolvida pela API.

Ensaio `node --import tsx test/receipt-report-browser-smoke.ts --run`: Chrome real → exportação estática/API compilada → Better Auth → PostgreSQL genérico isolado, sem interceptação. Uma venda parcelada e um pagamento fictício abatendo duas parcelas geraram uma linha e um CSV seguro; uma consulta inicial e uma exportação, auditoria preservada, `success=true`, `cleanup=true`. Primeira observação local: 235ms para navegar/mostrar recebimento; medida única, sem valor de SLO/capacidade ou produtividade humana. Capturas 1440/320px inspecionadas; tabela tem rolagem horizontal própria no celular e a página não excede a largura. Alinhamento de botões foi conferido após ajuste de espaçamento. Aplicação compilada/cluster/navegador do ensaio foram encerrados.

Coordenador definiu critérios, escreveu testes antes das fontes e executou verificações; não há parecer independente atribuído a outro agente nesta etapa. Logs/capturas genéricos privados e ignorados em `server/.local/validation/receipt-report-*`; configuração ampliada do ensaio também é privada. Falhas de fixture/infra não contam como RED de negócio. Não foram consultados registros reais, alteradas credenciais, executadas migrações remotas ou feitas emissão fiscal/operação bancária/commit/publicação. Próximo recorte: parcelas conectadas com saldo na data-base; depois vendas/OS e diagnóstico por empresa.

## Escopo autorizado — 18/10/2026

O usuário pediu logs para investigar problemas de uma empresa assinante específica e priorizou relatórios financeiros e operacionais: recebimentos, parcelas, vendas e OS. Testes devem ser definidos e executados antes da implementação. **Status: concluído no escopo local descrito abaixo**, com parecer independente de QA, regressão, tipos e build aprovados em 18/10/2026.

A aplicação atual é estática, com uma empresa demonstrativa, dados no navegador e sem identidade autenticada de empresa. O primeiro recorte entrega diagnóstico automático da instalação local, código de ocorrência, consulta e exportação mínima para suporte, além de relatórios calculados dos registros existentes. Não implementa coleta remota, portal de suporte multiempresa ou isolamento/autorização de servidor. O identificador da instalação serve para relacionar um pacote de suporte ao navegador da empresa; não é um tenant autenticado. Não usar CNPJ ou nome fiscal editável como identidade.

## Jornadas e utilidade

- Quando uma operação não é concluída, registrar a ocorrência automaticamente, mantendo a mensagem operacional e fornecendo um código para suporte. Não exigir que o atendente digite novamente empresa, OS ou dados do problema para alimentar o log.
- Em Diagnóstico, mostrar a instalação/empresa demonstrativa, filtrar ocorrências por período, nível, módulo e código, e exportar exatamente o conjunto filtrado. Informar quando o histórico só está em memória.
- Em Relatórios, escolher recebimentos, parcelas, vendas ou OS; usar datas e dados já disponíveis, filtrar pelo consumidor quando necessário e exportar as mesmas linhas mostradas. O filtro de consumidor é operacional; não substitui o contexto da empresa assinante.
- Nenhuma consulta ou exportação cria lançamento, altera saldo, fecha turno ou muda fiscal/estoque. O pacote de diagnóstico é separado do backup e dos relatórios com dados operacionais.

## Diagnóstico: contrato e invariantes

Arquivos de domínio: `src/lib/diagnostics/engine.ts` e `src/lib/diagnostics/store.ts`. Chave independente `sistem:diagnostics:v1`, sem alterar `DemoState.version = 3`. Limite técnico deste recorte: 200 ocorrências mais recentes por instalação; não é política de retenção legal ou comercial.

Cada ocorrência contém somente campos controlados: `id`, `at` (ISO), `level` (`warning` ou `error`), `code`, `module`, `operation`, `route` (rota conhecida sem parâmetros), `installationId` e `appVersion`. Empresa demonstrativa aparece como contexto declarado da interface; nenhum nome/documento fiscal editável é tratado como identidade confiável. Futura coleta centralizada deverá obter empresa e permissões da sessão do servidor.

- Catálogo inicial de códigos: `COMMAND_FAILED`, `STORAGE_READ_FAILED`, `STORAGE_WRITE_FAILED`, `RUNTIME_ERROR` e `UNHANDLED_REJECTION`. Comandos rejeitados são ocorrências, não prova automática de bug: validações de negócio também lançam `Error` no código atual. Títulos e descrições vêm do catálogo, sem armazenar a mensagem livre do erro.
- Projeção por lista permitida ao registrar, recuperar e exportar. Não copiar propriedades extras, parâmetros de URL, `Error.message`, stack, entradas de formulário, estado operacional, XML, senhas, tokens, nomes de consumidor, CPF/CNPJ, telefone, endereço, operador ou referência bancária. Identificadores da ocorrência e instalação são gerados pelo sistema.
- Registrar no máximo uma ocorrência por tentativa de comando rejeitada; envolver também validações anteriores ao commit e rejeições assíncronas. Operação bem-sucedida não é refeita nem transformada em evento monetário por causa do logger. Renderizações, filtros e notificações não são comandos a registrar.
- Recuperação/gravação operacional e erros globais também geram ocorrências controladas. Listeners globais devem ser removidos no encerramento. Uma falha do próprio diagnóstico não registra outra falha recursivamente.
- Falha de leitura/gravação de diagnóstico mantém o que for possível em memória, informa o limite e não impede a operação original. JSON diagnóstico inválido não bloqueia a aplicação. Falha de recuperação operacional continua preservando os bytes originais e bloqueando as mutações, conforme a regra já existente.
- O código exibido ao usuário deve corresponder à ocorrência exportada. O erro operacional original continua disponível à interface; não anexar dados desse erro ao pacote de suporte. Não enviar nada a serviço externo.

Contratos combinados antes dos testes e da implementação:

| Operação | Responsabilidade |
| --- | --- |
| `filterDiagnostics(events, filters)` | Filtrar por `from`, `to`, `level`, `module` e `query` de código/ID, usando dia civil de São Paulo e limites inclusivos. |
| `exportDiagnostics(events, filters, generatedAt)` | Produzir objeto JSON com versão, instante, filtros e eventos projetados, exatamente do conjunto filtrado. |
| `createDiagnosticRecorder(storage?, options?)` | Criar buffer isolado com relógio/gerador de IDs injetáveis; leitura, retenção, registro, snapshot estável e assinatura de mudanças, sem propagar falha do logger. |
| `instrumentOperation(operation, run, record)` | Executar uma vez, preservar retorno/erro original, registrar uma rejeição síncrona ou assíncrona; a integração apresenta o código sem reexecutar a operação. |

As funções e tipos públicos podem ter ajustes técnicos combinados antes da escrita dos testes, mantendo esses comportamentos. O armazenamento e os filtros locais não são uma barreira de autorização.

## Relatórios: contrato e significado dos valores

Arquivos de domínio: `src/lib/reports/engine.ts` e tipos associados. `buildReport(state, filters)` é puro e recebe `kind` (`receipts`, `installments`, `sales`, `orders`), `from`, `to`, `asOf`, `customerId` opcional e, para recebimentos, `method`/`accountId` opcionais. Retorna linhas, totais identificados e filtros aplicados. Validar datas civis estritas e ordem do intervalo; somar centavos inteiros seguros, sem arredondamento monetário silencioso.

| Relatório | Critério temporal e valores |
| --- | --- |
| Recebimentos | Período inclusivo de `FinancePayment.receivedOn`. Contar cada pagamento uma vez, com valor aplicado, meio, conta e origem. Alocação e movimento vinculados não são outras receitas. Legado de OS fica fora. |
| Parcelas | Período de vencimento e data-base de saldo explícita. Usar `installmentBalance(state, id, asOf)` e somente acordos existentes na data-base. Saldo positivo com vencimento anterior à base é vencido; vencimento na base não é atraso. |
| Vendas | Período de `Sale.date`, situação atual e valor comercial. Total vendido não é dinheiro recebido. |
| OS | Período de criação e situação atual. Separar valor comercial/orçado, aprovação, legado informado e novos recebimentos identificáveis. Sem aprovação não afirmar dívida gerada. Não reconstruir etapas históricas nem atribuir data/conta ao legado. Saldos inconsistentes precisam de indicação de revisão, sem crédito inventado. |

Reutilizar `financialDate`, `isCivilDate`, `installmentBalance` e vínculos existentes. A referência fixa `TODAY` dos exemplos não representa a data atual do relatório. O retrato operacional de OS é atual; uma data-base histórica financeira não transforma esse retrato em histórico completo da assistência. Não inferir lucro, DRE, extrato bancário real, fluxo completo de caixa ou produtividade.

`reportToCsv(report)` exporta o conjunto exibido com cabeçalho e identificação dos filtros. Escapar delimitadores, aspas e quebras de linha e neutralizar células que possam ser interpretadas como fórmulas. O relatório operacional pode incluir o nome do consumidor já cadastrado; esse conteúdo não pertence ao diagnóstico exportado.

## Critérios de aceite definidos antes do código

| ID | Cenário e resultado esperado |
| --- | --- |
| LOG-01 | Comando conhecido rejeitado: uma ocorrência com código, ação, módulo e instante, sem alterar o estado da operação rejeitada. Código de suporte exibido corresponde ao evento exportado. |
| LOG-02 | Campos extras/sensíveis no registro ou no armazenamento adulterado: descartá-los ao salvar, recuperar e exportar. Não exportar erro bruto, cadastros ou URL com parâmetros. |
| LOG-03 | Filtros combinados e datas nos limites em São Paulo: lista, contagem e exportação representam exatamente o mesmo subconjunto. |
| LOG-04 | Recarga e retenção: recuperar eventos válidos e conservar no máximo os 200 mais recentes. Diagnóstico inválido não derruba a aplicação. |
| LOG-05 | Persistência de diagnóstico negada e comando falho/sucesso: preservar comportamento original, sem recursão ou nova execução; informar que o buffer não foi salvo. |
| LOG-06 | Recuperação/gravação operacional falha: registrar catálogo controlado, preservar original e regras de bloqueio, sem copiar o arquivo para o log. |
| LOG-07 | Rejeição assíncrona e erro global: registrar uma ocorrência por evento/tentativa; remover listeners ao desmontar e não duplicar por renderização. |
| REL-01 | OS de 100000 centavos, legado 20000 e novo pagamento 30000: valor comercial 100000, novo recebido 30000, legado 20000 separado e saldo elegível 50000. Não somar pagamento, alocação e movimento como três receitas. |
| REL-02 | Pagamentos no início/fim, fora do período e próximos à meia-noite: filtro inclusivo pelo dia civil adequado; datas inválidas ou intervalo invertido rejeitados. |
| REL-03 | Parcela parcial, vencida e vencendo na data-base; data-base anterior a novo pagamento: saldo correto na base e sem antecipar atraso. |
| REL-04 | Consumidores A/B, meios e contas distintos: linhas e totais seguem os filtros; consumidor não é confundido com empresa assinante. |
| REL-05 | Vendas/OS: valor comercial e situação atual preservados; orçamento não aprovado não aparece como dívida confirmada; legado sem data não vira recebido no período. |
| REL-06 | Sem registros nos filtros: totais zero e estado vazio. CSV contém apenas linhas mostradas, filtros e cabeçalhos, com fórmulas neutralizadas e escape correto. |
| UI-01 | Diagnóstico e Relatórios acessíveis pela navegação, filtros por teclado, mensagens de erro recuperáveis e apresentação em 390 px sem rolagem horizontal da página. Consultas/exportações não alteram operações. |

## Execução e evidências

O analista delimitou os cenários e o arquiteto avaliou persistência, identidade e contratos, sem alterar o produto. QA escreveu os testes de domínio e navegador antes da implementação. Após os contratos públicos mínimos permitirem importar as funções, a execução inicial de 24 casos teve 23 falhas esperadas por comportamento ausente e um aprovado: esse último apenas rejeitava entradas enquanto os stubs rejeitavam tudo; não foi apresentado como prova da validação final.

Os arquivos foram divididos entre dois desenvolvedores: domínio/persistência e telas/CSS. O coordenador integrou os comandos, listeners, navegação e rotas `/diagnostico/` e `/relatorios/`. Nenhum comando operacional foi reimplementado pelo logger; os wrappers preservam o retorno e o erro original. QA manteve o runner exclusivo e acumulou a revisão independente, sem implementar o produto. O recorte anterior de abertura contextual do caixa e as demais alterações existentes foram preservados.

Após os testes prévios, QA acrescentou dois reforços: restauração exclui eventos de outra instalação e CSV mantém centavos exatos perto do limite numérico seguro. Ambos já estavam atendidos ao executar; não houve alegação de falha prévia desses dois casos. A conferência posterior identificou um defeito distinto de apresentação: `9007199254740987` centavos aparecia na linha como `90.071.992.547.409,88`, embora o CSV contivesse `90071992547409,87`. O 27º teste foi escrito e executado **antes da correção**, com 26 aprovados e essa falha reproduzida. A interface passou a separar os dígitos de reais e centavos, preservando precisão nas linhas e nos cartões, sem alterar a formatação global da aplicação.

Correções justificadas dos ensaios, preservando expectativas:

- Normalizar a fixture com `restoreDemoState` antes de gravá-la. A comparação anterior capturava os bytes antes da normalização preexistente de defaults fiscais/ordenação; a igualdade integral após a operação continua obrigatória. O ensaio de arquivo operacional inválido continua usando os bytes originais sem normalizá-los.
- Selecionar os `select` por `getByRole('combobox', { name, exact: true })`. A árvore acessível demonstrou os nomes corretos; `getByLabel` exato incluía o texto das opções no componente de campo existente. Foram preservados nomes, ações e resultados esperados.
- Aguardar o botão de exportação habilitado antes de disparar eventos globais sintéticos. O título vem no HTML antes da hidratação; emitir o evento antes dos listeners tornava inválida a preparação. Permanecem as expectativas de dois eventos, sanitização, filtros e recarga sem duplicação.
- Restringir os alertas ao diálogo operacional ou ao conteúdo principal, excluindo o anunciador de navegação do Next.js. O alerta e sua mensagem operacional continuam exigidos.

Arquivos dos testes: `tests/diagnostics-engine.spec.ts`, `tests/diagnostics-browser.spec.ts`, `tests/reports-engine.spec.ts` e `tests/reports-browser.spec.ts`, com fixtures e utilitários próprios. A cobertura de domínio usa resultados esperados explícitos e a cobertura de tela compara arquivos baixados, estado operacional, mensagens e navegação.

| Verificação desta entrega | Resultado |
| --- | --- |
| Novos testes após a correção | 27 aprovados: 18 de domínio e nove de navegador. Linha, total e CSV confirmados sem arredondar o centavo. |
| `npm.cmd test` | Regressão única: três checks estáticos e 96 casos Playwright aprovados, sem falhas ou casos ignorados; 55,4 s. São 69 casos existentes mais os 27 novos. |
| `npm.cmd run typecheck` | Aprovado pelo coordenador após o encerramento do servidor de QA. |
| `npm.cmd run build` | Compilação, checagem TypeScript, exportação estática e `postbuild` aprovados; novas rotas incluídas no artefato `out/`. |
| Revisão independente | QA conferiu catálogo/projeção, ausência de dados pessoais no diagnóstico, execução única dos comandos, recuperação bloqueada preservando bytes, separação dos estados e consultas sem mutação. Sem bloqueios abertos no recorte. |
| Teclado e celular | Filtros, mensagens recuperáveis, navegação e ausência de transbordamento horizontal da página verificados em Chrome; viewport móvel 390 × 844. Tabelas têm rolagem própria e região acessível por teclado. |

**Parecer do QA: Aprovado no escopo verificado da simulação local.** A remoção dos listeners no cleanup foi conferida por leitura; testes no navegador verificaram eventos controlados, recarga e ausência de duplicação. Não houve teste automatizado específico de desmontagem nem validação com atendentes reais.

Capturas finais inspecionadas pelo QA e pelo coordenador: [Diagnóstico desktop](evidencias/logs-diagnostico.png), [Diagnóstico celular](evidencias/logs-diagnostico-mobile.png), [Relatórios desktop](evidencias/relatorios.png) e [Relatórios celular](evidencias/relatorios-mobile.png). Desktop 1440 × 1000; capturas móveis integrais de 390 × 1684 e 390 × 2533, com menu fechado e sem erro de página durante a captura. As primeiras capturas móveis pegaram a transição do menu e foram refeitas após estabilização, sem alteração do produto. São dados fictícios básicos: no relatório de OS, comercial R$ 1.184,90, legado R$ 440,00, novos recebimentos R$ 0,00 e saldo elegível R$ 275,00; não são a fixture dos cálculos de REL-01.

Hashes SHA256 finais dos testes e fixtures, registrados pelo QA para identificar os arquivos verificados:

```text
diagnostics-engine.spec.ts D635D183E048557C16D7A521192F43BD433555475FF74BB013672F78BB76F1C3
diagnostics-browser.spec.ts 59A6AA249E42E80AD9307C71C5FAD87B726B438FD921B9829053ECD9B4AC8050
reports-engine.spec.ts 6F3754F45D8CEC76755538C400C3AFE7E3587548E3D648009563A649C9194AB3
reports-browser.spec.ts 1C37F2B925A522DF201313D08EEC110EC99DBADB26B8AA4F9B5C50BD05D4BF1E
reports-fixtures.ts 62A430AB58E539E69E4CED5C88BDF627C7D47B6CB43F87656B1B15B0382E8182
diagnostics-browser-helpers.ts 852BDA624C2A6E5091CA6BA607A9E6D2F635311A4D00CA5CC37E99EA037E389C
```

Conferência final do coordenador: quatro documentos em UTF-8 com 48 links locais existentes, seis hashes conferidos e os dois HTMLs das novas rotas presentes em `out/`; `git diff --check` aprovado. A conferência de 21 arquivos de código/testes/documentação também passou para UTF-8 e espaços finais; bloco gerado do Next.js preservado. Nenhuma expectativa foi alterada após o RED específico de precisão.

## Limites e continuidade

- O histórico é local e limitado a 200 eventos. Limpeza do navegador, outra máquina ou outra instalação não compartilham o diagnóstico; falha de gravação mantém apenas memória. O pacote exige exportação manual e não substitui backup, monitoramento central ou trilha de auditoria inviolável.
- O código é uma correlação técnica; a ocorrência de comando rejeitado pode ser uma validação de negócio. Não prova, sozinha, defeito do sistema. Mensagem bruta, stack e conteúdo do formulário não são coletados.
- A empresa é demonstrativa e o UUID identifica a instalação. Para suporte remoto por assinante, a próxima etapa depende de backend, sessão autenticada com empresa e permissões, armazenamento de eventos e consulta autorizada por empresa. Não confiar em um identificador enviado livremente pelo navegador como autorização.
- Relatórios consultam apenas os registros locais válidos, sem conciliação externa. Recebimentos não incluem legado de OS; parcelas usam data-base explícita; OS/vendas apresentam situação atual. Não há PDF, envio agendado, lucro/DRE ou fluxo de caixa completo nesta entrega.
- Nenhuma publicação, integração externa, nova dependência, operação bancária/fiscal ou alteração de configuração global foi realizada.

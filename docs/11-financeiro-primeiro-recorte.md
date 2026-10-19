# Primeiro recorte financeiro

Decisões da equipe em 17/10/2026. Este documento delimita a implementação demonstrativa derivada da [especificação financeira ampliada](09-financeiro-pagamentos-e-fluxo-de-caixa.md). Não substitui esse planejamento nem declara funcionalidades verificadas antes da conclusão do QA.

**Estado desta revisão:** recorte implementado no protótipo, verificado pelo QA nos cenários descritos abaixo e com build de produção aprovado. Artefato estático pronto; consulte a URL entregue pelo coordenador para o resultado publicado. A entrega não representa integração financeira real.

## Problema e comportamento anterior

O cliente precisa combinar entrada e parcelas, voltar à loja para pagar uma parcela total ou parcialmente e consultar o que ainda deve. A loja precisa identificar o recebimento, seu destino e o efeito monetário, sem confundir a venda original, a dívida e o dinheiro disponível.

Antes desta etapa, `FinancePage`, em `src/features/commercial.tsx`, listava somente OS aprovadas. `receivePayment`, em `src/lib/demo-store.tsx`, incrementava `ServiceOrder.received` e acrescentava o método como texto ao histórico. Não havia parcela financeira, pagamento com identidade própria, conta de destino, movimento monetário ou turno de caixa. `Sale`, em `src/lib/domain.ts`, não continha condição de pagamento.

Esse valor acumulado não permite reconstituir data, conta, meio ou liquidação de cada recebimento. Não é saldo bancário ou dinheiro contado. A nova etapa deve preservar essa informação, sem convertê-la em entrada fictícia.

## Entrega delimitada

Uma jornada utilizável no protótipo:

1. Selecionar uma venda confirmada/entregue ou OS aprovada com saldo positivo.
2. Conferir cliente, total comercial, valor histórico informado e saldo disponível para acordo.
3. Preparar uma condição com entrada opcional e parcelas, mostrar a prévia e confirmar valores e vencimentos.
4. Localizar uma parcela e receber um valor total ou parcial em dinheiro, Pix ou transferência.
5. Mostrar o recibo interno reproduzível e o histórico do recebimento.
6. Consultar os novos movimentos por conta e as parcelas pendentes, mantendo realizado, vencido e previsão de entradas separados.

Dinheiro exige turno mínimo de caixa: abrir com operador, receber, conferir saldo esperado, informar contagem e fechar preservando a diferença. Pix/transferência exigem declaração de conferência manual, conta e referência; não há consulta ao banco.

**Fora desta entrega:** cartão, cheque, pagamento misto numa mesma baixa, pagamento abrangendo várias parcelas, juros/multas/descontos, renegociação, crédito de cliente, contas a pagar, despesas, transferências entre contas, sangria/suprimento, importação/conciliação de extrato, estorno/correção de recebimento, reembolso e integrações externas. Pagamentos sucessivos em meios diferentes são registros separados; isso não equivale a uma operação de pagamento misto.

O extrato e a projeção deste recorte não constituem fluxo de caixa completo, lucro ou DRE. Não contemplam obrigações a pagar nem todos os recebíveis possíveis. Não usar essa versão para controlar dinheiro real.

## Decisões e invariantes

### Origem, acordo e parcelas

- Um acordo por origem, identificada por tipo e ID: venda ou OS. A ação repetida não pode gerar outro acordo.
- Somente OS aprovada ou venda confirmada/entregue; orçamento não aprovado não cria dívida.
- O acordo guarda uma cópia identificável da origem, cliente, total comercial e legado considerado. Mudança posterior no cadastro não reescreve o recibo ou a condição aceita.
- Para OS, o principal do novo acordo é `total comercial - received legado`. Para venda sem histórico de recebimento, corresponde ao total da venda. Legado inválido ou superior ao total exige revisão, sem criar saldo negativo ou crédito automático.
- `ServiceOrder.received` fica preservado como legado. O resumo da OS deve derivar **legado + novos pagamentos válidos**, uma vez, sem regravar esse total sobre o legado.
- Confirmar o acordo cria títulos, não liquida a entrada nem movimenta conta.
- Entrada positiva tem título e vencimento próprios. Entrada igual ao principal permite somente esse título; entrada zero exige parcelas para o saldo.
- Toda parcela tem principal positivo em centavos inteiros seguros. A soma de entrada e parcelas é exatamente o principal do acordo; não aceitar diferenças silenciosas.
- Rateio determinístico: o resto é distribuído, de um centavo por parcela, a partir das primeiras. Exemplo: R$ 100 em três parcelas = R$ 33,34 + R$ 33,33 + R$ 33,33.
- Quantidades e datas possuem limites técnicos explícitos; esses limites não representam política de crédito ou regra legal da loja.
- Vencimentos são datas civis estritas `YYYY-MM-DD`. Calendário mensal conserva o dia originalmente escolhido: 31/01/2027 → 28/02/2027 → 31/03/2027. Ajustar fevereiro não muda a âncora de março. A prévia permite editar os vencimentos individuais, mantendo datas válidas e a ordem do cronograma. Os valores são rateados automaticamente; redistribuição manual de valores fica fora desta entrega.
- Vencimento passado é permitido e destacado como atraso. Não adicionar juros nem deslocar a cobrança para hoje automaticamente.
- Origens inconsistentes devem permanecer identificáveis, com motivo e caminho para revisão. Não ocultar silenciosamente uma OS cujo legado exceda o total ou uma venda cujo total divirja dos itens.
- Após o acordo, bloquear alteração de cliente, peças, serviço, aprovação e legado recebido da OS (`customerId`, `parts`, `labor`, `approved`, `received`). Diagnóstico, previsão e andamento podem mudar sem alterar o acordo. Renegociação fica para etapa própria.

### Pagamento, alocação e movimento

- Cada baixa aplica um pagamento a uma parcela explícita, com método, valor, operador, origem de conferência, instante e conta de destino.
- O valor deve ser inteiro seguro em centavos, positivo e menor ou igual ao saldo atual da parcela. A validação ocorre sobre o estado mais recente do protótipo, não só sobre o número exibido no formulário.
- A gravação local cria pagamento, alocação e movimento correspondente juntos; erro não deixa parcela quitada sem movimento ou movimento sem pagamento.
- A confirmação repetida com a mesma chave de idempotência e mesmo conteúdo devolve o registro existente. A mesma chave com conteúdo conflitante é rejeitada. Isso não promete transação entre abas, computadores ou servidor.
- Dinheiro exige conta física e turno aberto da mesma conta. Registrar valor entregue e troco: R$ 200 entregues para aplicar R$ 150 geram troco de R$ 50 e entrada líquida de R$ 150, sem outra receita ou desconto.
- Pix/transferência exigem conta bancária ativa, referência e conferente manual identificado. Marcar a declaração significa uma informação prestada pelo usuário da demonstração; não significa confirmação obtida do banco. Não oferecer opção de baixar com base apenas em agendamento/comprovante não conferido.
- Não coletar cartão/CVV ou credenciais bancárias; esses meios não são implementados nesta etapa.
- Recibo interno identifica a demonstração, origem, cliente, parcela, valor aplicado, método, conta, data, operador, eventual entregue/troco e saldo resultante. Reabrir um recibo não realiza outra baixa. Não é documento fiscal.
- Receber não altera estoque, entrega, situação fiscal ou valores comerciais. Cancelamento fiscal não desfaz dinheiro recebido.

### Datas e relógio

Decisão final do coordenador, alinhada com desenvolvedor e QA: o financeiro usa o dia civil atual em **America/Sao_Paulo**, derivado do instante do evento. O usuário não escolhe data retroativa ou futura de recebimento nesta etapa. Vencimentos de parcelas permanecem datas civis editáveis, com outra finalidade.

O instante de auditoria e o dia civil do movimento são informações relacionadas, mas diferentes. Não obter o dia financeiro cortando uma data UTC sem considerar o fuso; perto da meia-noite os dias podem divergir. Testes de domínio podem fornecer um relógio controlado e uma data-base explícita.

Uma aba já aberta deve atualizar a data-base ao atravessar a meia-noite de São Paulo e ao retornar ao foco. Novos recebimentos também atualizam o resumo para não ficarem ocultos por uma data-base carregada no dia anterior.

A ordem dos instantes também é validada: pagamento não pode anteceder o acordo ou a abertura do turno; fechamento não pode anteceder a abertura nem os pagamentos incluídos; reabertura não pode anteceder o fechamento anterior. A equipe identificou que conferir somente o dia civil permitiria gravar um estado incompatível com a restauração. Escrita e restauração precisam aceitar a mesma cronologia.

A referência operacional fixa de 16/10/2026 (`TODAY`) continua nos exemplos do restante da aplicação. Não usá-la para fingir que um novo pagamento ocorreu naquela data. A visão financeira deve indicar sua própria data-base atual. Na criação deste documento, a data do usuário é 17/10/2026.

### Contas e turno mínimo

- O protótipo começa com contas fictícias de caixa físico e banco, com saldo inicial demonstrativo zero explicitado e não editável neste recorte. Não há declaração de fundo real nem saldo bancário inicial real. Essas contas não representam a contagem ou saldo histórico da loja.
- Abrir turno registra operador, conta, instante e saldo escritural de referência; abrir não cria receita. Permitir apenas um turno aberto para a conta física.
- Receber em dinheiro exige turno aberto da conta correspondente. Não admitir recebimento em turno fechado nem fechar o mesmo turno outra vez como nova operação.
- Fechar registra saldo esperado, valor contado, diferença, responsável e instante. Não criar ajuste automático para fazer a contagem coincidir.
- O fechamento não reescreve movimentos. Diferença permanece visível; eventual abertura posterior não transforma a contagem divergente em saldo corrigido silenciosamente.
- Sem controle real de identidade e autorização no protótipo: nome informado de operador é declaratório, não prova autoria autenticada.

### Extrato, previsão e legado

- Extrato apresenta apenas os novos movimentos identificáveis e os saldos iniciais demonstrativos explícitos. Legado de OS não entra como movimento.
- Disponibilidade demonstrativa resulta dos movimentos efetivos por conta; não somar novamente o principal da venda ou o acordo como dinheiro recebido.
- Previsão é **parcial, de entradas de acordos existentes**. Não contém saídas/contas a pagar, recebíveis de operadora/cheques ou origens sem acordo.
- Parcela parcialmente recebida projeta apenas o saldo ainda aberto. Valor liquidado sai da previsão e entra no realizado uma única vez.
- Vencidos ficam separados da previsão futura e são risco de cobrança; não presumir recebimento certo hoje.
- Valores de origens ainda sem acordo ficam indicados como não programados, em vez de inventar vencimentos ou omitir essa limitação.

## Migração e contratos mínimos

Preservar os registros operacionais e fiscais existentes nas versões anteriores do estado local. A extensão financeira começa com coleções próprias, sem criar pagamentos, turnos ou movimentos a partir de `OS.received`. Preservar exportação/restauração e testar recarga após a migração. Se uma validação impedir restaurar o estado, preservar o conteúdo original para recuperação em vez de sobrescrevê-lo silenciosamente com os exemplos.

O modelo implementado em `src/lib/finance/types.ts` possui contas, turnos, acordos, parcelas, pagamentos, alocações e movimentos. As operações puras estão em `src/lib/finance/engine.ts`; a restauração financeira está em `src/lib/finance/persistence.ts`. Essa leitura estática confirma a presença dos contratos, sem substituir testes de comportamento.

Contratos de domínio acordados:

| Operação | Entrada e efeito obrigatório |
| --- | --- |
| `previewAgreement` / `prepareAgreement` | Origem, entrada e parcelas; permitir `installmentDueDates` individuais opcionais, preservando o rateio automático; conferir elegibilidade, duplicidade, legado, datas, ordem e soma; criar acordo e títulos juntos. |
| `recordPayment` | Parcela, método, valor, conta, operador, confirmação e chave da tentativa; validar sobre saldo atual; criar pagamento/alocação/movimento uma única vez. |
| `openCashShift` | Conta física e operador; verificar ausência de outro aberto; preservar saldo de referência, sem receita. |
| `closeCashShift` | Turno, contagem e operador; preservar esperado, contado e diferença sem ajuste de saldo. |
| `installmentBalance` / `orderReceived` / `accountBalance` / `financeSummary` | Derivar saldo por parcela, total por origem e conta, histórico, recebimentos e previsão parcial com data-base explícita. |
| Consultar recibo | Ler os dados preservados do pagamento; sem nova baixa e sem alteração por cadastro posterior. |

Persistência permanece no navegador. Idempotência local e validações do cliente não substituem backend transacional, autenticação, autorização por empresa, isolamento, auditoria confiável e recuperação. O projeto continua prevendo banco operacional separado por empresa em produção.

## Critérios de aceite do recorte

| ID | Dado / Quando | Então |
| --- | --- | --- |
| F1-01 | Venda de R$ 1.200; confirmar R$ 300 de entrada + 3 × R$ 300. | Criar quatro títulos somando R$ 1.200, todos pendentes, sem movimento monetário. |
| F1-02 | OS de R$ 1.200 com R$ 300 informados em `received`; criar acordo do saldo. | Preservar legado; títulos somam R$ 900; nenhum movimento de R$ 300 é fabricado. |
| F1-03 | R$ 100 em três parcelas; gerar prévia e confirmar. | R$ 33,34 + R$ 33,33 + R$ 33,33, sem perda de centavos; recarga preserva valores. |
| F1-04 | Parcelamento mensal a partir de 31/01/2027. | Fevereiro termina em 28/02, março volta a 31/03; rejeitar data inexistente, sem deslocamento por fuso. |
| F1-04b | Editar vencimento de uma parcela na prévia. | Confirmar a data individual válida sem mudar os valores rateados; rejeitar quantidade de datas incompatível e ordem inválida. |
| F1-05 | Acordo já existe, OS não está aprovada, saldo é zero ou legado supera total. | Impedir outro acordo/inválido sem alterar dados anteriores. |
| F1-06 | Parcela de R$ 300; registrar R$ 200. | Manter R$ 100 pendentes, outras parcelas intactas e um pagamento/movimento de R$ 200. |
| F1-07 | Baixa em dinheiro, sem turno, conta errada ou turno fechado. | Bloquear; não alterar parcela, conta ou recibos. |
| F1-08 | Turno aberto; entregar R$ 200 para aplicar R$ 150. | Troco de R$ 50, entrada líquida de R$ 150; recibo preserva a discriminação. |
| F1-09 | Pix/transferência sem conferente, referência ou confirmação explícita. | Bloquear baixa; não indicar confirmação automática do banco. |
| F1-10 | Valor zero, negativo, superior ao saldo ou fora dos inteiros seguros. | Rejeitar sem gravação parcial; manter caminho para corrigir o formulário. |
| F1-11 | Reenviar a mesma tentativa de pagamento. | Mesmo conteúdo devolve registro original; conteúdo diferente com a mesma chave gera conflito; não duplica movimento. |
| F1-12 | Abrir caixa; receber; fechar com contado diferente do esperado. | Abertura não é receita; diferença e valores originais permanecem; não surge ajuste automático. |
| F1-13 | Recarregar após acordo, recebimento e fechamento. | Preservar parcelas, histórico, movimentos, recibo e estado do turno. |
| F1-14 | Alterar cadastro do cliente após pagamento; reabrir recibo. | Mostrar dados preservados do recebimento, sem refazer a baixa. |
| F1-15 | Existe acordo; tentar alterar total/cliente/aprovação/legado da OS. | Bloquear alteração financeira; permitir andamento sem modificar o acordo. |
| F1-16 | Pagar parcela e examinar origem, estoque e fiscal. | Atualizar resumo derivado uma única vez; preservar estado operacional/fiscal e estoque. |
| F1-17 | Visualizar previsão com parcelas parcialmente pagas, futuras e vencidas. | Somente saldo futuro aparece na previsão parcial; vencidos separados; realizado não é contado outra vez. |
| F1-18 | Registrar instante UTC que corresponde ao dia anterior em São Paulo. | Dia civil do movimento usa America/Sao_Paulo; sem data de recebimento livre ou referência operacional fixa. |
| F1-18b | Instante retrocede dentro do mesmo dia após abertura/pagamento/fechamento. | Rejeitar cronologia incompatível antes de gravar; estado produzido por operações válidas continua restaurável. |
| F1-19 | Restaurar estado anterior com dados do usuário. | Preservar cadastros, OS, vendas, documentos e legado; não inventar movimentos/conta/data financeira. |
| F1-20 | Receber no celular, reabrir recibo e produzir erro de validação. | Fluxo acessível sem depender de uma tabela larga; erro identifica correção e preserva entradas pertinentes. |

Na interface móvel, parcelas são apresentadas como cartões, com a ação de receber acessível e ano do vencimento identificado. A versão de tabela permanece para telas maiores. Origens inconsistentes mostram a pendência e o caminho de revisão.

## Verificação e pendências

O analista definiu o recorte e revisou os contratos e a interface por leitura do código, sem executar a suíte. O QA escreveu e executou verificações independentes; o relato abaixo registra os resultados comunicados por ele em 17/10/2026, sem converter a soma das rodadas numa execução única que não ocorreu.

| Execução | Resultado observado pelo QA |
| --- | --- |
| `npm.cmd test` | Três checks da exportação estática aprovados. Nos 53 casos Playwright daquela rodada, 52 passaram e um falhou por seletor ambíguo entre alerta e notificação; não foi defeito de preservação dos dados. |
| Correção e regressão direcionada | Seletor de recuperação tornado específico. A coordenação também corrigiu a mensagem global de gravação/recuperação local e acrescentou atualização da data financeira na virada do dia; o QA incluiu o cenário correspondente. |
| Reexecução direcionada de jornadas financeiras e recebimento parcial | Oito casos aprovados em 14,5 segundos, incluindo os sete casos financeiros de navegador e a regressão de recebimento parcial. |

Comando da reexecução direcionada:

```powershell
npm.cmd exec -- playwright test tests/finance-browser.spec.ts tests/prototype.spec.ts --grep "finance-browser|recebimento parcial preserva saldo" --reporter=line
```

Considerando as duas rodadas, foram verificados **54 casos Playwright distintos**: 22 de domínio financeiro, sete financeiros de navegador e 25 regressões existentes; além dos três checks estáticos. Não houve declaração de uma execução final única com 54/54. A falha de seletor foi corrigida e a área afetada foi reexecutada.

Evidências versionadas:

- Capturas do artefato estático final em Chrome: [parcelas no computador](evidencias/financeiro-parcelas.png) e [parcelas no celular](evidencias/financeiro-mobile.png), com dados exclusivamente fictícios.
- [Domínio financeiro](../tests/finance-engine.spec.ts): centavos, calendário mensal e datas individuais, elegibilidade, legado, saldo parcial, conferência manual, idempotência/conflito, contas/turnos, troco, cronologia, recibo, previsão, migração e restauração inconsistente.
- [Jornadas financeiras](../tests/finance-browser.spec.ts): entrada e parcelas, recebimento parcial, erro com valores preservados, Pix/transferência conferidos, dinheiro/turno/troco, fechamento divergente/reabertura, recibo/recarga, legado, recuperação e exportação do arquivo original, virada em São Paulo e celular.
- [Regressões operacionais](../tests/prototype.spec.ts) e [fiscais](../tests/fiscal-engine.spec.ts), executadas dentro da suíte inicial, com repetição da regressão de recebimento parcial na rodada direcionada.

O parecer do QA é **aprovado no escopo verificado de entradas demonstrativas**, sem defeito funcional aberto observado. Não aprova produção, fluxo de caixa completo, saídas, conexão bancária, isolamento entre empresas ou concorrência no servidor. O saldo inicial diferente de zero usado em um cenário de domínio é apenas uma fixture de teste; a interface desta entrega continua com zero não editável.

**Verificação de tipos:** a coordenação informou três rodadas aprovadas após integração e correções. O analista e o QA não executaram essas rodadas.

**Verificação manual em Chrome, feita pela coordenação:** OS #1041 com saldo de R$ 95 dividido em R$ 31,67 + R$ 31,67 + R$ 31,66; calendário 31/10 → 30/11 → 31/12; recebimento parcial de R$ 20 em Pix e recibo com saldo de R$ 11,67 na parcela. A inspeção em 390 px não apresentou vazamento de largura nem erros de página. Depois dessa inspeção, a apresentação móvel das parcelas foi aprimorada para cartões com a ação de receber visível. O QA reexecutou os dois cenários afetados, ambos aprovados: recebimento parcial/recibo/recarga e celular com teclado, foco, Escape e ausência de vazamento de largura. Essa repetição não acrescenta casos distintos à contagem anterior.

**Compilação de produção, executada pela coordenação:** `npm.cmd run build` aprovado, incluindo compilação, TypeScript e geração de 17 páginas estáticas. O postbuild adicionou os 15 aliases de segmentos esperados pela correção de exportação Windows já documentada no README.

**Validação do artefato estático final em Chrome, feita pela coordenação:** navegação de Vendas para Organizar pagamento; acordo de R$ 79,90 com entrada de R$ 20 e três parcelas; Pix manual parcial de R$ 10; recibo `REC-DEMO-00001`. A recarga preservou o estado na versão 3, um pagamento e um movimento de 1.000 centavos. O legado da OS #1041 permaneceu em 10.000 centavos. No celular de 390 px, a largura do documento foi 390 px e a ação Receber permaneceu visível. Não houve erros de console/página nem respostas HTTP com erro.

**Distribuição:** artefato estático pronto e validado. O resultado publicado deve ser conferido na URL entregue pelo coordenador, sem antecipar conclusão de deploy neste documento.

Antes de produção, além do backend e das identidades reais, será necessário completar correções/estornos e reembolsos, saídas/contas a pagar, movimentações de caixa, política de crédito, conciliação e os meios aceitos pelo cliente piloto. Cartão ou cheque não poderão ser habilitados apenas como opções de texto.

Não houve pesquisa normativa nova para este recorte: trata-se de decisões internas do produto, sem declaração de conformidade fiscal, bancária, contábil ou legal.

## Verificação da base pela equipe — 18/10/2026

Na rodada conjunta, o QA definiu o plano pelos critérios existentes antes de executar os comandos. Executou `npm.cmd run typecheck` com saída 0 em 7,863 segundos e `npm.cmd test` com saída 0 em 96,609 segundos. Nesta execução única passaram três checks estáticos e 54 testes Playwright, sem falhas ou casos ignorados: 22 de domínio financeiro, sete financeiros de navegador, nove de domínio fiscal, seis fiscais de navegador e dez regressões operacionais. `test-results/.last-run.json` registrou `passed`, sem testes falhos. O servidor iniciado pelo Playwright foi encerrado após a execução.

O parecer foi **Aprovado no escopo verificado da simulação existente**. Não houve novo build, alteração de produto ou teste escrito nesta rodada. Esses resultados não verificam o recorte planejado abaixo, produção, integração bancária, isolamento real ou concorrência entre abas. Os relatos de 17/10 permanecem históricos, separados desta execução.

## Abertura de caixa no recebimento

**Estado em 18/10/2026: implementado e verificado; tipos, 15 testes do recorte, regressão completa e build aprovados.** O usuário autorizou executar o plano após a rodada de análise. QA escreveu e executou os testes antes do código; desenvolvedor implementou a interface; QA verificou o comportamento e revisor examinou o diff de forma independente. Receber diretamente na venda e receber várias parcelas juntas permanecem evoluções separadas.

### Problema identificado e jornada implementada

O atendente já selecionou a parcela e informou os dados do recebimento. Antes da melhoria, a interface mandava fechar a janela e abrir o caixa em outra aba. O fechamento desmontava `PaymentModal` e perdia seus estados locais; o teste existente `tests/finance-browser.spec.ts:180` percorre esse desvio e preenche novamente método, valor aplicado, entregue e conferente. Essa lacuna operacional motivou o recorte, sem defeito monetário reproduzido na análise inicial.

No recebimento em dinheiro sem turno, a ação **Abrir caixa nesta conta** mantém a mesma parcela e revela a abertura no mesmo diálogo. Método, conta, valores e conferente ficam preservados. O conferente é sugerido como operador em campo separado, visível e editável; não há sobrescrita do conferente nem identidade autenticada presumida. Confirmar a abertura cria somente o turno e retorna ao recebimento preenchido. Pagar continua exigindo outra confirmação explícita.

O especialista identificou na sequência do teste anterior 12 interações após o primeiro preenchimento, com duas trocas de aba e quatro controles preenchidos novamente. Essa contagem vem da leitura do cenário, não de ensaio com atendentes ou medição de produtividade. Os novos testes verificam que a abertura contextual permite continuar sem essas trocas de aba e repetições, mantendo as conferências financeiras; não foi medido ganho de tempo com usuários reais.

### Cenários definidos antes do código

| ID | Dado / Quando | Resultado esperado |
| --- | --- | --- |
| ABR-01 | Parcela de R$ 300; dinheiro, conta física ativa, aplicar R$ 150, entregar R$ 200, conferente Ana e nenhum turno; confirmar abertura contextual. | Preservar parcela e todos os dados; criar um turno e zero pagamentos, alocações, movimentos ou recibos. Saldo da parcela continua R$ 300; após concluir a gravação local, recarga restaura o turno sem recebimento. |
| ABR-02 | Após a abertura, confirmar explicitamente o recebimento; repetir a mesma tentativa e recarregar. | Exatamente um pagamento, uma alocação e um movimento de R$ 150; troco de R$ 50, saldo de R$ 150 e recibo preservados. Abrir o caixa nunca dispara essa baixa. |
| ABR-03 | Cancelar a etapa de abertura pelo botão ou Escape; em outro ensaio, abrir o turno e depois cancelar o recebimento. | Na primeira situação, manter o diálogo aberto e retornar ao recebimento preenchido e ao acionador da abertura, sem criar turno. Na segunda, turno permanece aberto e não há pagamento; cancelar recebimento não desfaz a abertura. |
| ABR-04 | Operador vazio/espaços ou conta inválida/inativa; tentar abrir e depois corrigir. | Bloquear sem gravação parcial; apresentar a correção, preservar dados financeiros e permitir nova tentativa. Operador editado não altera o conferente. |
| ABR-05 | Já existe turno da mesma conta, inclusive criado entre o início e a confirmação no estado local. | Não criar segundo turno. Atualizar o contexto ou informar conflito preservando os dados; só usar turno válido no pagamento. Não prometer coordenação entre abas. |
| ABR-06 | Percorrer abertura e recebimento por teclado e em 390 × 844; verificar também Pix/transferência. | Foco entra no operador e retorna de modo previsível ao cancelar/concluir, sem sair do modal. Enter na etapa de abertura não recebe a parcela. Ações alcançáveis sem rolagem horizontal; meios bancários não mostram abertura e mantêm referência/conferente/conferência manual. |
| ABR-07 | Conta tem turno ainda aberto com dia de abertura anterior ao dia financeiro atual. | Não tratar o turno como apto, não criar outro e não fechar/ajustar automaticamente. Explicar que é necessário tratar o turno anterior em Caixa e contas; preservar dados enquanto o usuário permanece na jornada. Fechamento contextual fica fora deste recorte. |

ABR-01 a ABR-06 foram definidos pelo analista e complementados pelo especialista; o QA acrescentou a exceção ABR-07, confirmada na revisão de `src/lib/finance/engine.ts:573`. O QA escreveu [15 testes](../tests/finance-cash-opening.spec.ts) antes da implementação: 13 com navegador, incluindo repetição da tentativa por contrato público, e dois puros de domínio. Conflito de estado atualizado e repetição de pagamento são verificados no domínio; não constituem teste de coordenação entre abas ou servidor. Os resultados de execução e o ajuste justificado do estado inicial de um teste estão registrados abaixo.

### Implementação e limites

- `PaymentModal`, em `src/features/finance/page.tsx`, permanece montado e alterna os formulários de abertura e recebimento, sem aninhá-los ou abrir outro diálogo. A ação que inicia a etapa não envia o formulário de recebimento.
- `Modal`, em `src/components/ui.tsx`, recebeu propriedades opcionais de cancelamento e teclado. Somente o recebimento usa os novos tratamentos: Escape durante a abertura impede o fechamento nativo e retorna ao recebimento preenchido; Tab/Shift+Tab circulam nas bordas entre os controles visíveis e habilitados da etapa atual. Demais consumidores mantêm o comportamento anterior.
- O foco vai ao operador ao iniciar, ao acionador ao cancelar e à confirmação de recebimento ao concluir a abertura. Operador e conferente são estados independentes; Enter durante a abertura não recebe a parcela.
- `openCashShift({ accountId, operator })` continua exclusivo da abertura; `registerInstallmentPayment` é chamado somente na confirmação posterior, com a chave da tentativa preservada. Não houve alteração de domínio, store, persistência, CSS, dependências ou versão dos dados.
- Foram preservados conta física ativa, turno único e do mesmo dia, cronologia, saldo mais recente, troco, idempotência do pagamento e independência de fiscal, estoque e legado. Rejeitar uma segunda abertura não é a mesma garantia que repetir um pagamento com sua chave de idempotência. Turno anterior é informado e bloqueado; não é fechado automaticamente.
- Arquitetura: o estado muda em memória antes da escrita de `localStorage`, que ocorre em efeito. Há aviso global de falha de armazenamento; retorno do comando não prova gravação durável. Testar recuperação/recarga e não transformar o plano em promessa de persistência de servidor.
- A sugestão arquitetural de compor acordo e pagamento em uma única transição local pertence à evolução futura de receber na venda. Encadear comandos separados pode deixar gravação parcial nessa futura composição; não é um bug reproduzido da jornada atual nem requisito para abrir turno contextualmente.

**Exclusões:** receber diretamente na venda, pagamento conjunto ou misto, novos meios, fechamento de turno dentro do recebimento, fundo de caixa, migração, estorno, backend, autenticação e integrações. A verificação utiliza dados fictícios; não houve validação com usuários reais.

### Execução dos testes antes e depois do código

O QA executou os novos testes antes de liberar a implementação. O revisor conferiu as expectativas e os contratos por leitura, sem executar o runner nem aprovar em nome do QA.

| Etapa | Comando e resultado |
| --- | --- |
| Antes do código | `npm.cmd exec -- playwright test tests/finance-cash-opening.spec.ts --reporter=line,json`: 15 casos, dez falhas esperadas e cinco aprovados, 43,943 segundos. Nove falhas eram a ação contextual ausente; uma era a falta de orientação para turno anterior. Sem ignorados ou instáveis. |
| Primeira implementação | Mesmo comando: 13 aprovados e duas falhas. Uma comparação usava a fixture anterior à hidratação; a outra revelou saída do foco por Tab na última ação em 390 × 844. |
| Correção do ensaio ABR-01 | A restauração preexistente acrescenta `documents.mode` em `src/lib/demo-persistence.ts:129`. O QA passou a capturar o estado salvo após hidratar, antes de qualquer ação de abertura. Todas as igualdades integrais de contas, acordos, parcelas, OS, vendas, produtos e documentos foram mantidas. Coordenador e revisor conferiram independentemente a justificativa. Reexecução isolada: um caso aprovado em 5,1 segundos. |
| Correção de foco | Desenvolvedor corrigiu o ciclo de Tab/Shift+Tab sem mudar a expectativa ABR-06 ou apenas deslocar o foco inicial. Os 15 casos passaram em 16,8 segundos. |
| Regressão final | QA executou `npm.cmd test -- --reporter=line,json`: três checks estáticos e 69 testes Playwright aprovados, incluindo os 15 novos; Playwright em 47,004 segundos, sem falhas, ignorados ou instáveis. |
| Tipos | Desenvolvedor executou `npm.cmd run typecheck` após a implementação e novamente após a correção de foco, ambos com saída 0. |
| Build | Coordenador executou `npm.cmd run build` após o QA encerrar seus servidores: compilação, TypeScript e 17 páginas estáticas aprovados, com 15 aliases adicionados pelo postbuild existente. |

O arquivo original dos testes tinha SHA256 `d271f022be18215fb2b625a2728fef14d80f3677cd911d8dfbe7978aa5bcab8f`; após o único ajuste justificado do estado inicial de ABR-01, `447b793861282073e3b879a3cd94261ee8ee35b1efec2f5b22bd5f5dd746e288`. Não foram removidas expectativas para obter aprovação. Os relatórios anteriores foram preservados pelo QA em arquivos temporários da sessão; esta descrição registra os resultados sem depender da presença desses arquivos em outro clone.

O QA também realizou uma inspeção independente em Chrome, fora do spec: Tab e Shift+Tab envolveram corretamente as bordas nas etapas de abertura em computador/celular e no recebimento em celular. Enter criou um turno e zero pagamentos, alocações ou movimentos; o diálogo permaneceu aberto. Em 390 × 844 não houve vazamento horizontal. Nessa inspeção não foram observados erros de página, console ou respostas HTTP com erro. Os servidores iniciados pelo QA foram encerrados antes do build.

Evidências da abertura, com dados fictícios: [computador — 1440 × 1000](evidencias/financeiro-abertura-caixa.png) e [celular — 390 × 844](evidencias/financeiro-abertura-caixa-mobile.png).

**Parecer final do QA: Aprovado no escopo verificado da simulação local.** **Revisor: Aprovado no escopo de revisão estática**, sem bloqueio aberto no diff final; não executou os testes. O coordenador integrou documentação e build. As capturas e jornadas novas foram verificadas com o servidor de desenvolvimento; o build gera o artefato estático, sem nova publicação ou declaração de integração real. Permanecem os limites de persistência local, ausência de identidade real e de verificação entre abas/servidor já descritos neste documento.

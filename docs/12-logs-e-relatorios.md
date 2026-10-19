# Diagnóstico e relatórios da loja

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

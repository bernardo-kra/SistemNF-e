# Cadastros sem interromper o atendimento

## Recorte e estado — 23/10/2026

O usuário pediu para criar cadastros faltantes diretamente no campo que os utiliza, preservando o formulário em andamento, e aplicar o padrão a todos os locais pertinentes. **Status: concluído no recorte local, com QA independente, regressão, tipos e build aprovados em 23/10/2026.** O analista inventariou os seletores por leitura; QA escreveu e executou os testes antes do código, desenvolvedor integrou jornadas e coordenador implementou componentes compartilhados/persistência e consolidou evidências.

A implementação atual é local ao navegador. Não existe formulário de ordem de compra nem identidade real de usuários; o exemplo do pedido se aplica à OS. Técnico é cadastro operacional de nome, separado de senha, acesso, vínculo autenticado e permissão. O backend do documento 13 permanece em preparação e não entra nesta entrega.

## Onde aplicar

| Jornada/campo | Comportamento esperado |
| --- | --- |
| OS nova ou edição → Cliente | `Cadastrar cliente` junto ao seletor; salvar seleciona o novo cliente e retorna à OS com todos os campos preenchidos. Não salva a OS. |
| OS nova ou edição → Técnico responsável | `Cadastrar técnico` junto ao seletor; somente nome operacional. Seleciona após salvar, persiste para outras OS e mantém nomes legados. Não cria conta de acesso. |
| Painel → Sua equipe na assistência | Mostrar o mesmo catálogo de técnicos, incluindo quem ainda não tem OS, em vez de uma lista fixa de nomes. |
| Venda → Cliente | Mesmo cadastro de cliente, mantendo produto, quantidade e demais dados da venda. |
| Venda → Produto | Mesmo cadastro do catálogo; novo produto começa com zero físico/reservado. Selecionar o cadastro não confirma venda ou entrada. Oferecer `Registrar entrada` no contexto para quantidade e referência conferidas separadamente. Produto serializado continua inelegível para venda demonstrativa. |
| Produtos/Estoque e produto na venda → Categoria | Campo editável com sugestões do catálogo e categorias padrão; permite nova categoria sem trocar de tela nem perder nome, SKU ou preços. Após salvar o produto, a categoria fica disponível para reutilização. |
| Importação XML → Produto | Já tem criação por item, preço, revisão e confirmação contextual. Preservar esse caminho e o estoque zero; não cadastrar antecipadamente fora da confirmação da importação. |

Filtros de clientes/produtos/relatórios/diagnóstico e enums de tipo, UF, regime, modelo fiscal e meio de pagamento não são cadastros dependentes. Operações de origem e contas financeiras exigem atos e conferências próprios; não criar venda, aprovação, conta, saldo ou documento automaticamente por um atalho. Parceiros não têm seletor operacional nesta versão. Responsáveis pela aprovação, retirada e conferência financeira são registros textuais, não seleção de um cadastro de pessoas; não transformar esses campos em identidade autenticada.

## Continuidade e integridade

- Quem atende permanece na mesma rota e confirma explicitamente apenas o cadastro faltante. Os dados já informados no formulário principal não são digitados novamente. Cancelar, fechar ou pressionar Escape na etapa de cadastro volta ao formulário intacto, com seleção anterior quando nada foi salvo.
- Salvar o cadastro é uma confirmação própria: o registro continua existindo se a OS/venda for cancelada depois. Não duplicar cadastro por abertura/renderização e não enviar o formulário principal ao salvar/cancelar a etapa auxiliar.
- Erro de cadastro fica na etapa auxiliar e preserva os dois rascunhos. CPF/CNPJ continuam opcionais com validação existente quando preenchidos; SKU permanece único. Cadastro não produz estoque, reserva, financeiro ou fiscal.
- Produto novo na venda mostra saldo zero e orienta a entrada explícita. Registrar entrada pede quantidade inteira positiva e referência; somente a confirmação soma físico. Cancelar não soma estoque; confirmar entrada não confirma venda. A venda continua dependendo de saldo suficiente e confirmação própria.
- Nome de técnico é normalizado para comparar duplicidade, preservando o nome legível. `Não atribuído` representa ausência e não pode virar novo técnico. Nomes existentes em OS antigas continuam disponíveis e seus registros não são reescritos. Cadastro operacional não concede acesso.
- Etapas auxiliares usam formulários separados, títulos acessíveis únicos, foco restrito à etapa ativa e retorno do foco ao campo/acionador. Não aninhar formulários HTML ou compartilhar ID de título entre diálogos. Não perder o formulário principal ao atualizar o catálogo.

## Contratos técnicos antes dos testes

- Componentes em `src/components/contextual-catalog.tsx`: `CustomerEditor({customer?,onSaved,onCancel})`, `ProductEditor({product?,onSaved,onCancel})`, `TechnicianEditor({onSaved,onCancel})` e `StockEntryEditor({product,onSaved,onCancel})`. São formulários sem modal próprio, com eventos de submit isolados do formulário principal; reutilizados pelas telas e pela etapa auxiliar.
- `ContextualDialog({title,description?,onClose,children})` abre diálogo auxiliar fora do DOM do formulário principal e impede propagação indevida. O formulário principal permanece montado. Ao retornar, restaura o foco; `Modal` ganha ID de título por instância.
- `CategoryField({defaultValue})` aceita texto e sugere valores padrão e os já cadastrados. Não cria tabela paralela de categorias.
- `FormActions` aceita `disabled?` opcional, preservando os consumidores existentes. Na venda, a confirmação fica desabilitada enquanto cliente/produto/quantidade/saldo não forem elegíveis; a guarda do comando permanece.
- Tipo `Technician = {id:string,name:string}` e extensão opcional `DemoState.technicians?: Technician[]` na versão local 3. A restauração valida a extensão quando presente e incorpora técnicos referenciados nas OS antigas quando ausente, sem gerar movimentos ou alterar históricos. `saveTechnician(technician)` valida nome/duplicata e grava uma vez pelo mesmo commit protegido da aplicação. Retorna o registro salvo; nomes das OS continuam sendo snapshots textuais.
- Cliente/produto continuam usando `saveCustomer`/`saveProduct`; erros e bloqueio de recuperação preservados. `saveTechnician` entra no catálogo controlado de diagnóstico sem nome/dados pessoais no evento.
- Arquivos de integração exclusivos do desenvolvedor: `service-orders.tsx`, `commercial.tsx`, `customers.tsx`, `products.tsx`. Coordenador: componentes compartilhados, domínio/persistência/store/seed/diagnóstico, CSS e documentação. QA: novos testes e evidências; nenhum agente altera arquivos de outro responsável.

## Critérios de aceite definidos antes do código

| ID | Cenário verificável |
| --- | --- |
| CAD-01 | Preencher todos os campos de OS; criar cliente e técnico no contexto. Seleções atualizadas, campos e rota iguais; nenhuma OS até confirmar. |
| CAD-02 | Cancelar/fechar/Escape no cadastro auxiliar: seleção e rascunho principal preservados. Erro recuperável no filho não cria parcial nem envia o pai. |
| CAD-03 | Salvar cadastro e depois cancelar OS/venda: cadastro existe uma vez após recarga; operação principal não foi criada. |
| CAD-04 | Venda preserva cliente, produto e quantidade ao cadastrar cliente; ao cadastrar produto preserva cliente/quantidade e seleciona o novo produto com aviso de saldo zero. |
| CAD-05 | Produto novo não gera estoque/reserva/venda. Entrada contextual valida quantidade/referência; cancelamento não grava, confirmação soma físico uma vez, venda posterior reserva uma vez. |
| CAD-06 | Produto aceita categoria nova; categorias existentes/importadas são sugeridas e reutilizáveis. SKU duplicado mostra erro sem perder os rascunhos. |
| CAD-07 | Técnico legado continua selecionável; novo cadastro persiste ao recarregar, sem mudar OS anteriores ou conceder acesso. Extensão local inválida bloqueia recuperação e preserva bytes. |
| CAD-08 | Teclado/Enter/Escape afetam somente etapa ativa, foco retorna e celular 390 px mantém ações acessíveis sem transbordamento da página. |
| CAD-09 | XML contextual, regra de acordo financeiro e demais jornadas existentes permanecem válidos. Nenhum efeito monetário/fiscal surge ao criar cadastro. |

Ensaios podem comprovar zero trocas de rota e preservação dos valores informados; não representam medição de tempo, ganho de produtividade ou validação com atendentes reais.

A edição de dados fiscais existentes é um fluxo adjacente distinto: os links de correção podem abandonar a seleção de origem/modelo. Este recorte trata dependências ausentes; não substitui as telas de emitente/revisão fiscal por cadastros rápidos nem afirma resolver a continuidade dessas correções.

## Execução e evidências

O analista mapeou os cadastros dependentes e os casos que já funcionavam no contexto. QA escreveu 22 cenários antes de qualquer alteração de produto. O primeiro ensaio foi interrompido por localização inadequada de controles preexistentes; a árvore acessível demonstrou os nomes corretos. Foram usados `getByRole` para o técnico e a textarea de diagnóstico, mantendo entradas e expectativas. A rodada completa teve 21 falhas pertinentes e uma falha de localização na edição; depois do ajuste justificado, somente esse caso foi repetido e alcançou o botão ausente `Cadastrar técnico`. Assim, os 22 cenários tiveram falha esperada comprovada antes do produto.

Coordenador e desenvolvedor implementaram conjuntos de arquivos exclusivos após esse gate. Os editores compartilhados mantêm os campos existentes de cliente/produto e as validações fiscais opcionais. A etapa auxiliar usa um portal com diálogo e formulário separados; o pai permanece montado. O submit do filho não propaga para o pai e os títulos dos diálogos têm IDs próprios. Foco retorna ao acionador ou ao campo Produto quando a confirmação de entrada remove o botão que o abriu.

Durante a revisão, QA encontrou um defeito na primeira implementação da restauração: um nome de técnico legado acima de 100 caracteres era incorporado ao catálogo, mas falhava ao restaurar uma segunda vez. Antes da correção, escreveu um 23º teste puro e reproduziu a falha. O limite continua no novo cadastro/HTML; a restauração conserva nomes antigos integralmente, sem tornar dados anteriormente válidos irrecuperáveis. O teste de dupla restauração passou depois da correção, preservando catálogo, OS e financeiro.

**Primeira GREEN: 23 testes aprovados em 26,4 s**, sem ajuste das expectativas depois da implementação. São `tests/contextual-catalog.spec.ts`, `tests/contextual-persistence.spec.ts` e utilitários de fixture próprios. Cenários cobrem dados de OS e venda, confirmação independente do cadastro, cancelamentos, CPF/SKU inválidos, nomes duplicados/reservados, categorias, entrada/reserva, produto serializado, teclado, celular, painel e compatibilidade da persistência.

| Verificação desta entrega | Resultado |
| --- | --- |
| Novos cenários | 23 aprovados, incluindo o teste acrescentado antes da correção de compatibilidade. |
| `npm.cmd test` | Regressão única: 119 casos Playwright e três checks estáticos aprovados, sem falhas ou casos ignorados; 1,5 min. Os 96 casos existentes também passaram. |
| `npm.cmd run typecheck` | Aprovado pelo coordenador após a integração e a correção de compatibilidade. |
| `npm.cmd run build` | Compilação, checagem TypeScript, exportação estática e pós-processamento aprovados após o servidor QA ser encerrado. |
| Revisão independente | QA conferiu portal/formulários separados, títulos acessíveis, foco, persistência, comandos e diagnóstico. Sem bloqueios abertos no recorte verificado. |
| Uso reproduzível | Mesma rota, campos preservados, seleção do cadastro salvo e nenhuma OS/venda antes da confirmação própria. Testes não medem produtividade ou tempo de atendimento. |

**Parecer do QA: Aprovado no escopo verificado da simulação local.** O coordenador também inspecionou as capturas: [Técnico durante a OS](evidencias/cadastros-os-tecnico.png), [Técnico no celular](evidencias/cadastros-os-mobile.png) e [Venda depois da entrada explícita](evidencias/cadastros-venda-entrada.png). Desktop 1440 × 1000 e celular 390 × 844. A imagem da venda mostra cinco unidades disponíveis, quantidade três e a confirmação ainda pendente, com foco devolvido ao produto após a entrada.

Identificação SHA256 dos arquivos finais verificados pelo QA:

```text
contextual-catalog.spec.ts 6DFD6E116234F4948CBDE5C550D16B1017995A808D6F6B83FD79920BDAB3C375
contextual-persistence.spec.ts 4655DD0D4B98DFD84EBCB2E54C695DC0B0A95426035B3D5F630538379AA77704
contextual-helpers.ts 86DB2519E86B9FF82DBAD1274246F76F8B6AE357B3B2DD5A47E50036DABA402B
```

Limites: Chrome local e dados fictícios, armazenamento somente no navegador, sem autenticação, sincronização de servidor ou validação com atendentes reais. Backend, compras, encaminhamento a parceiros e continuidade das correções fiscais seguem seus recortes próprios. Nenhuma dependência nova, alteração de configuração global, publicação ou commit foi realizada nesta tarefa.

## Preços e lucro estimado do produto — 23/10/2026

**Solicitação e estado inicial:** o usuário apontou a falta de preço de compra, preço de venda e cálculo de lucro nos produtos. A lista mostrava somente o preço de venda; o editor compartilhado chamava a compra de `Custo de referência`. Não havia cálculo de lucro. Este recorte melhora a consulta do catálogo e o mesmo editor usado durante a venda, sem alterar movimentos ou o custo de compras anteriores.

**Status: concluído no protótipo local, com QA independente, tipos e build aprovados.**

### Critérios definidos antes da implementação

- Mostrar na lista de Produtos preço de compra, preço de venda e lucro estimado por unidade, sem abrir o cadastro. A tela de Estoque mantém suas quantidades.
- No cadastro, apresentar compra e venda com nomes claros e reaproveitar os valores existentes. Calcular automaticamente o resultado enquanto o operador digita, sem campo de lucro editável, botão de cálculo, navegação ou chamada de backend.
- Lucro estimado = venda − compra, em centavos. Margem = lucro / venda × 100, exibida com duas casas e identificada como percentual sobre a venda. Compra de R$ 20,00 e venda de R$ 35,00 resultam em R$ 15,00 e 42,86%. Não calcular markup como se fosse margem.
- Mostrar valores negativos quando a venda estiver abaixo da compra. Compra zero é válida; venda zero permite diferença negativa, com margem indisponível, sem divisão por zero.
- Campo monetário vazio/inválido não equivale a zero: mostrar `A calcular`. Preço de venda pendente também não gera estimativa na lista. O editor exige valores válidos para salvar, aceitando zero explícito e mantendo os números de referência existentes.
- Identificar a estimativa como anterior a impostos, taxas e outras despesas. O campo de compra reutiliza `Product.cost`, referência por unidade do catálogo; não representa custo médio, última compra nem apropriação completa dos custos. Não alterar relatórios financeiros para apresentar esse resultado como lucro contábil.
- Cancelar não modifica o catálogo. Salvar modifica os preços e os campos editados do produto, preservando estoque, reservas, pedidos, OS e histórico financeiro. Recarregar mantém os valores; o cadastro contextual preserva o rascunho da venda.
- QA define e executa os testes antes do produto e revisa a entrega independentemente. A interação antiga que buscava `Custo de referência` passa a buscar `Preço de compra` pela mudança explícita de nomenclatura solicitada pelo usuário; os valores e resultados esperados dos testes existentes permanecem.

Verificação visual prevista: Chrome em 1440 × 1000 e 390 × 844, leitura dos valores e do resultado, ações acessíveis no editor e rolagem restrita à tabela sem transbordamento da página. Caminho comum: zero cliques adicionais para consultar preços/lucro na lista e zero ações adicionais para calcular no cadastro; salvar continua sendo uma confirmação própria. Inspecionar navegação/rede durante a digitação e registrar somente medições realizadas no ambiente local.

### Execução e evidências dos preços

QA escreveu `tests/product-pricing.spec.ts` antes de alterar o produto: os seis cenários falharam pelos controles ausentes (coluna de compra, rótulo de compra e saída de lucro). Após esse gate, o coordenador implementou o componente compartilhado `product-profit.tsx`, o cálculo vivo em `ProductEditor`, as colunas na lista de Produtos e os estilos. Sem mudança de schema, store, migração ou dependências. Compra passa a ter preenchimento válido obrigatório no editor, com zero explícito permitido; valores vazios não são convertidos em custo zero ao salvar.

Os seis testes passaram em 7,5 s, sem alteração após o RED. Cobrem consulta sem abrir o cadastro, margem sobre venda, centavos, prejuízo, zeros, dados ausentes, pendência de venda, cancelamento, persistência e preservação de estoque/histórico. O cadastro contextual preservou cliente, produto e quantidade da venda principal. O helper existente mudou somente o rótulo solicitado, mantendo os preços de teste e as expectativas anteriores.

| Verificação desta rodada | Resultado |
| --- | --- |
| `npm.cmd test` pelo QA | 170 testes Playwright e três checks estáticos aprovados, sem falhas ou ignorados; regressão única em 1,7 min. |
| `npm.cmd run typecheck` pelo coordenador | Aprovado depois do encerramento do servidor QA. |
| `npm.cmd run build` pelo coordenador | Compilação, TypeScript, exportação estática e pós-processamento aprovados; 17 aliases de segmentos. |
| Revisão independente | QA aprovou os quatro arquivos de produto no escopo verificado, sem bloqueios encontrados. |
| Desktop e celular | Preços e lucro integralmente visíveis na tabela desktop; celular com rolagem horizontal restrita à tabela, sem transbordamento da página. Editor e ações acessíveis; Tab passa de compra para venda. |
| Esforço e resposta local | Zero botão de cálculo, campos de lucro digitados, navegações ou chamadas de backend durante o cálculo. Duas observações isoladas de atualização de 10 e 11 ms, incluindo automação Playwright; não são benchmark ou promessa de desempenho. |

Capturas com dados fictícios, também inspecionadas pelo coordenador: [lista desktop](evidencias/produtos-precos.png), [lista no celular após rolar a tabela até os preços](evidencias/produtos-precos-mobile.png) e [cadastro com cálculo automático](evidencias/produtos-precos-cadastro.png). Em 1440 px, tabela de 1136 px sem rolagem; em 390 px, página de 390 px e tabela rolável de 348 px. O nome do produto continua à esquerda na tabela; a captura mobile enquadra os preços.

Hashes SHA256 iguais no RED e GREEN desta rodada; o novo hash do helper corresponde à atualização legítima de rótulo e comentário, posterior à entrega contextual anterior:

```text
product-pricing.spec.ts CB19703C869B3AFCFC7DB622331F38E081E647CC6826CA27EEF2DE9EBDC2A752
contextual-helpers.ts 21315887066120BAE7E4DB90C035A60FED5B518E8C01383B955870AE73EE53CD
```

Limites: Chrome local e dados fictícios; sem validação com usuários reais. O resultado é uma estimativa com o preço de compra de referência do catálogo, sem custo médio, apropriação de despesas ou apuração contábil. Persistência permanece local com os limites já documentados no README. Nenhum commit, publicação ou integração externa nesta rodada.

## Continuidade do preço no contexto — 24/10/2026

Ao selecionar produto com preço pendente na venda, `Definir preço` abre o mesmo editor já preenchido, com foco no preço de venda. Salvar ou cancelar preserva cliente, produto e quantidade; salvar o catálogo não confirma o pedido. O cadastro individual de produto agora grava antes de anunciar sucesso, preservando os rascunhos se a gravação for recusada.

A mesma rodada acrescenta a definição em lote na tela de Produtos. Critérios LPR, testes prévios, execução, evidências e limites estão no [cadastro assistido da workspace](../../docs/07-cadastro-assistido.md), seção **Precificação em lote e preço no contexto**. Este complemento não substitui os resultados históricos registrados acima.

## Cadastros no carrinho com vários produtos — 24/10/2026

O carrinho mantém cliente e todas as linhas ao abrir cadastros auxiliares. Produto, preço e entrada atuam no item acionador; resolver uma pendência no Item 2 devolve o foco ao seletor desse item quando o acionador desaparece, preservando os outros produtos e quantidades. Novo cliente vale para o pedido inteiro. Cada cadastro/entrada conserva sua confirmação própria; somente confirmar o carrinho cria a venda/reserva do conjunto.

Requisitos CAR, testes prévios, execução e resultados ficam no [fluxo da venda na workspace](../../docs/02-fluxos-e-requisitos.md), seção **Carrinho com vários produtos**. Os testes anteriores dos cadastros foram preservados; a nova cobertura inclui linhas adicionais, preço/entrada na segunda linha e recuperação de gravação sem perder a tentativa.

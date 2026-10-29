# Cadastros sem interromper o atendimento

**Publicado em29/10/2026:** seletores únicos de cliente/produto e recebimento contextual da OS online com o código `9c108b8`; formulários/pesquisa conferidos em HTTPS sem escrita de negócio. [Publicação e limites](15-auditoria-acessos-e-filtros.md). Os registros locais abaixo preservam o histórico da implementação.

## PSEL/OS-CSEL — seleção no próprio campo — 28–29/10/2026

**Concluído localmente; não publicado. Aceite definido antes das fontes.** Continuidade do estudo de eficiência: corrigir produto nos dois editores de venda conectada e reutilizar o seletor único de cliente na criação de OS. Atendente já informou carrinho, quantidades/descontos ou equipamento/serviço/técnico; buscar outra opção ou cadastrar no contexto não pode apagar esses dados. Recebimento na própria OS exige recorte financeiro posterior, sem inferir pagamento nesta entrega.

Produto por linha usa um campo que pesquisa e escolhe, sem Buscar produto global e seletor duplicado. Resultados atuais separados dos produtos confirmados no carrinho; não acumular resultados antigos. Mostrar nome/SKU, preço pendente ou valor e saldo disponível conhecido, sem confundir modelo parecido com identidade. Digitação não confirma produto; alterar o texto limpa ID/desconto daquela linha, mantendo quantidades e outras linhas. Resultado ativo escolhido atualiza o cache em memória; scanner continua com resolução exata e tratamento de ambiguidade existentes. Cadastro novo ocupa linha vazia ou acrescenta linha, sem substituir produto confirmado.

Verificações prévias PSEL: campo único nos dois editores; Alfa→Beta remove Alfa dos resultados sem perder Alfa na outra linha; chamadas apenas ao focar/pesquisar, debounce250ms, limite20, nenhum fetch ao alterar quantidade/desconto/condição; resposta atrasada/empresa incompatível não seleciona; nome igual exige escolha explícita diferenciada por SKU; teclado/toque/Escape e realce visível; falha com retentativa preserva carrinho; inativo não vira seleção; preço pendente/sem saldo não inventam elegibilidade; scanner e cadastro contextual preservados. Uma confirmação para a venda, sem gravação por escolha ou navegação adicional. Medir chamadas e resposta no ambiente declarado, sem promessa de produtividade humana.

Verificações OS-CSEL: nome/telefone/e-mail no mesmo Cliente, sem Buscar cliente; somente identidade escolhida permite criar; editar texto limpa ID; cadastro/cancelamento e busca tardia preservam equipamento, serviço, técnico e valores; erro/autorizações/troca de empresa seguem o componente de cliente já verificado. Testes automatizados pertinentes devem rodar antes da alteração e reproduzir campos ausentes; registrar resultados e limites ao encerrar.

### Execução PSEL/OS-CSEL

Coordenador escreveu16 cenários antes das fontes. PSEL01 nos dois editores e OS-CSEL01 tiveram três REDs pela duplicação dos campos; após implementar `product-picker.tsx` e reutilizar `CustomerPicker`, os16 passaram. Produtos confirmados ficam no cache do carrinho e opções da pesquisa só no seletor; somente uma escolha atualiza produto/versão. Complementos de refoco/Enter e toque móvel elevaram a cobertura nova para18, sem atribuir RED prévio a esses dois casos adicionais. Scanner mantém a consulta exata com tratamento de ambiguidade. Cadastro no editor sem financeiro deixou de substituir a última linha preenchida: usa uma vazia ou acrescenta outra.

Regressão pertinente: **100/105** inicialmente. Cinco falhas eram adaptação de interação: OP-UI06 ainda esperava ID no valor visível de Cliente; quatro UXR OS localizavam uma opção nativa de técnico homônimo antes dos resultados da busca. Valor visível passou a esperar nome e opções foram delimitadas ao listbox de clientes. Conferências de identidade nos comandos, preservação e geometria continuaram. Rodada final **23/23** (18 novos e os cinco anteriores corrigidos), exit0; **107 cenários únicos aprovados em rodadas**, sem alegar regressão completa de toda a aplicação. Dois casos foram repetidos somente para registrar captura e medição técnica que o reporter de linha não persistiu como attachment.

Tipos web/servidor, seis checks Node e `npm.cmd run build` aprovados; build compilou a API e normalizou36 aliases estáticos. Integração real `server/test/operations-browser-smoke.ts` com Chrome → Better Auth/API → PostgreSQL isolado aprovou cadastro contextual de OS, cliente escolhido, produto pesquisado, reserva/baixa exatas, importação500, histórico, custo restrito, revogação403 e logout401, com `success:true`, `cleanup:true` e zero navegações de documento após login. A primeira tentativa falhou ao localizar o botão genérico de histórico, depois dos efeitos operacionais já conferidos; o seletor foi delimitado ao produto e a rodada completa passou. Capturas desse utilitário agora usam diretório privado de validação, preservando evidências documentais anteriores. Somente fixtures genéricas; nenhum dado da conta do usuário foi consultado ou exportado.

Capturas1440px/390px inspecionadas pelo coordenador; controles sem transbordamento da página, com rolagem vertical do formulário. Cenários automáticos também conferiram320/390px e OS em768/1024px. Ensaio de toque390px, Chrome headless, Next aquecido/API controlada local: **346ms** entre iniciar a digitação automatizada e encontrar o resultado, incluindo debounce250ms e automação; uma consulta de produto, nenhuma ao mudar quantidade, uma escrita ao confirmar venda e zero navegações de documento. É uma observação isolada, não INP, SLO, tempo de atendimento humano ou ganho validado. JSON/capturas e logs `selection-*` ficam ignorados em `server/.local/validation/`.

Implementação e verificações desta etapa são do coordenador, sem revisão independente atribuída a outro agente para PSEL. Sem mudança adicional de contrato backend/schema nesse seletor. Não foram repetidos todos os testes backend nessa etapa; o ensaio real usa a API existente. Serviços dessa rodada encerrados. A continuidade posterior implementou o [recebimento no contexto da OS](11-financeiro-primeiro-recorte.md), com testes prévios de origem, saldo e recuperação e revisão independente. Demais achados da auditoria continuam pendentes; publicação foi autorizada posteriormente em29/10.

## CSEL — cliente da venda em um único campo — 28/10/2026

**Recorte e aceite definidos antes do código:** eliminar a sequência `Buscar cliente` + seletor `Cliente` nos dois editores de venda conectada. Um campo Cliente pesquisa por nome, telefone/e-mail disponíveis no backend e permite selecionar o resultado na própria lista, por toque/clique ou setas/Enter. Apenas digitar não confirma uma identidade; homônimos exigem escolha e mostram contatos disponíveis. Alterar o texto invalida a seleção anterior. Respostas de pesquisas antigas não repovoam resultados ou trocam a seleção. Sem consulta de documentos ou mudança de API/banco.

Quem atende já possui empresa, usuário, carrinho, quantidades e descontos; não redigita esses valores para trocar/criar cliente. Cadastro auxiliar conserva o formulário; cancelar conserva busca/seleção anterior válida, salvar mostra o novo cliente e seu ID sem outra pesquisa obrigatória. Consulta sem resultado ou indisponível oferece orientação/retentativa e cadastro somente a quem possui direito. Nenhum cliente é criado ao digitar. Autorização e elegibilidade continuam sendo revalidadas no servidor ao concluir a venda.

Esforço esperado: um campo, uma escolha do resultado, zero troca de rota e uma confirmação para a venda inteira. Pesquisa somente ao interagir, com debounce, páginas de até20 e substituição dos resultados (sem acumular o catálogo de buscas anteriores). Nenhuma requisição adicional por selecionar um resultado já retornado; digitação contínua não gera uma chamada por tecla. Enter na lista não conclui a venda; Escape fecha primeiro as sugestões. Verificar teclado, 320/390px, edição sem seleção, homônimos, falha/retentativa, cadastro contextual e respostas atrasadas antes da entrega. OS, filtros da tela Clientes e demonstração não são alterados automaticamente por este recorte.

### Implementação CSEL

`src/features/customer-picker.tsx` e seu CSS encapsulam consulta, resultados atuais, contatos, estado de seleção e teclado. Checkout e venda sem financeiro usam o mesmo componente; criação no contexto seleciona o objeto retornado sem consulta extra. Campo confirma um ID somente ao escolher resultado/cadastro salvo. Mudança do texto remove o ID antes da próxima consulta; cancelamento/retentativa mantém os demais dados. Resultado tem empresa conferida e é descartado se a consulta foi abortada/superada. Até20 registros por resposta; buscas amplas pedem refinamento. A API não foi ampliada para CPF/CNPJ.

Testes CSEL01–02 tiveram RED da ausência do campo editável antes do código. Na primeira rodada dos dez casos, seis passaram e quatro localizaram também opções nativas de produto/pagamento; os seletores foram limitados ao listbox de clientes, sem alterar expectativas. A revisão estática independente apontou refoco/Enter trocando o cliente confirmado e realce fora da área visível; CSEL10/11 reproduziram ambos antes das correções. O termo agora acompanha o texto exibido, Enter sem novo realce preserva seleção e setas mantêm o resultado visível. Rodada específica **12/12 aprovada**, incluindo mobile e cadastro contextual.

Os testes anteriores passaram a escolher o cliente pelo resultado e conferir o nome exibido, preservando as verificações de ID no comando, valores, estoque e recuperação. Os seletores dos smokes financeiros/operacionais foram adaptados, sem atribuir execução real desses smokes a esta tarefa. Uma primeira regressão teve 83/86: um teste ainda esperava ID no campo visível e dois encerramentos falharam por colisão de artefatos após execução paralela de runners Playwright. A expectativa de exibição foi corrigida e as rodadas passaram a ser sequenciais, com pasta própria; erro de artefato não é apresentado como aprovação funcional.

**Verificação final:** rodada sequencial **88/88**, exit code 0 (12 CSEL + vendas/financeiro, operação, sessão e usabilidade). CSEL12 adicional aprovou toque em contexto móvel com busca por telefone e ID correto: **13 cenários novos / 89 únicos aprovados no recorte, em rodadas**. Seis checks Node e tipos web/servidor aprovados. Inspeção visual em 1440/320px, com um campo Cliente, nenhum Buscar cliente separado e ausência de rolagem horizontal; capturas somente com fixtures genéricas. Revisão estática independente após as correções sem bloqueadores. Logs privados técnicos `customer-picker-*` em `server/.local/validation/`. Build e encerramento registrados no [guia da equipe](10-equipe-de-agentes.md). Sem migração, escrita no banco da empresa, publicação ou validação com atendentes reais.

## Auditoria de consistência das jornadas — 28/10/2026

**Status: análise concluída, correções não implementadas nesta auditoria.** O usuário perguntou se existem outras inconsistências semelhantes à duplicação Buscar cliente/Cliente. Conferência do código atual em `checkout.tsx`, `operations-page.tsx`, `finance-live.tsx` e contratos de `server/src/operations.ts`. Critérios prévios de avaliação: digitação repetida, escolhas perdidas, pesquisas coerentes com resultados, trocas de tela evitáveis e fidelidade dos estados financeiros; não classificar toda confirmação de estoque/dinheiro como clique dispensável.

| ID | Achado e evidência | Classificação / direção para correção |
| --- | --- | --- |
| UX-A01 | Venda ainda separa Buscar produto dos seletores Produto por linha. Resultados são mesclados ao catálogo anterior e todas as opções continuam visíveis: pesquisa Beta manteve Alfa, mesmo com API retornando somente Beta. Fonte: consulta e map de produtos em `checkout.tsx`, mesmo padrão no editor sem financeiro. | Bug de coerência da busca + redundância. Separar cache dos produtos já no carrinho dos resultados atuais e usar busca/adição no contexto, preservando scanner, quantidades e preços. |
| UX-A02 | Nova OS mantém Buscar cliente + Cliente e acumula respostas anteriores. Pesquisa Beta manteve Alfa. Fonte: efeito `customerSearch` e seletor no `OperationEditor`. | Bug de coerência + padrão divergente da venda já corrigida. Aplicar o seletor único com as conferências de identidade, sem perder equipamento/técnico/valores. |
| UX-A03 | Em pagamento, trocar Pix por transferência limpa `accountId` incondicionalmente, embora ambos usem banco; reproduzida perda da conta selecionada. Fonte: `PaymentFields`. | Perda evitável de escolha. Preservar conta se continuar ativa/compatível; resetar conferência do novo pagamento continua necessário. Conta incompatível não pode ser reaproveitada. |
| UX-A04 | Mão de obra da OS inicia em 0,00; o modelo usa valor numérico, sem estado próprio de orçamento pendente. Fonte: draft/entrada `order.create`; padrão observado no navegador. | Ambiguidade de negócio, diferente de bug de pesquisa. Definir e distinguir preço pendente de serviço explicitamente gratuito antes de mudar persistência/aprovação/financeiro. Não afirmar dívida criada a partir de orçamento indefinido. |
| UX-A05 | Entrega de OS mostra informação financeira disponível, mas o comando ainda exige `allowUnsettled:true` e declara ausência de conferência financeira integrada. Fonte: editor de entrega e `order.deliver`. | Lacuna funcional já documentada, com risco de interpretação. Integrar decisão de entrega ao saldo e à política autorizada, sem inferir quitação nem permitir exceção silenciosa. |
| UX-A06 | Listas/detalhe de venda e OS permitem combinar pagamento, mas não oferecem recebimento posterior no contexto; é necessário ir ao Financeiro e localizar o cliente conhecido. Fonte: ações das linhas e `ReceiveEditor` no módulo financeiro. | Troca de tela evitável. Oferecer receber com cliente/origem já preenchidos e alocação conferida; não aplicar silenciosamente o valor a outra dívida do mesmo cliente. |
| UX-A07 | Produto criado durante venda solicita nome/SKU; novo registro sem preço/saldo exige depois definir preço e registrar entrada em etapas auxiliares. Fonte: `AuxiliaryForm`, `CatalogFix`. | Oportunidade de simplificação, não autorização para inventar estoque. Reunir complementos necessários no contexto, com efeito de entrada física explicitamente conferido e sem campos extras obrigatórios no caminho comum. |
| UX-A08 | Aprovação e testes da OS são registrados por ações próprias e depois exigem Avançar etapa. Fonte: ações de OS em `OperationsPage`. | Oportunidade dependente da rotina/permissões. Ações como Registrar testes e marcar pronta podem coordenar os dois fatos explicitados, se autorizados; aprovar não deve iniciar execução silenciosamente. |

Reprodução somente em Chrome local/API controlada com fixtures fictícias isoladas: produto/cliente Beta mantendo Alfa, conta perdida ao mudar Pix → transferência e mão de obra inicial zero. Resultado técnico booleano em `server/.local/validation/usability-audit-result.json`, `mutations:0`. Não houve chamadas ao banco da empresa, recebimento, baixa de estoque ou alteração do aplicativo. Os demais achados são leitura de fluxo/contrato e propostas, não ensaios com atendentes. Documentação e links conferidos; sem build/testes de regressão nesta auditoria documental. Correções futuras precisam de cenários e testes prévios próprios. Prioridade sugerida: buscas coerentes de produto/cliente OS; depois recebimento/entrega e estado de orçamento; simplificações restantes conforme a rotina validada.

## Recorte e estado — 23/10/2026

Os registros abaixo descrevem a entrega demonstrativa original. Para o estado conectado, consulte o recorte CSEL e a auditoria atuais no início deste documento.

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

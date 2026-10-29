# Requisitos funcionais e não funcionais

Referência: **28/10/2026**. Base: [regras de negócio RN-001–RN-036](16-regras-de-negocio.md). O [mapa](18-mapa-mental.md) oferece a visão geral; o [resumo](19-resumo-para-clientes.md) pode ser enviado ao cliente.

O [estudo de eficiência no uso diário](21-eficiencia-no-uso-diario.md) fundamenta a revisão das jornadas: tarefa correta, reaproveitamento de informação, esforço, espera e recuperação medidos separadamente. Menos cliques, isoladamente, não comprova melhoria.

**C:** conectado no recorte atual. **D:** somente demonstração. **P:** pendente. Critérios abaixo são expectativas para testes; sua presença neste documento não significa teste executado ou recurso entregue. Evidências anteriores permanecem nos documentos de cada entrega.

## Requisitos funcionais

| ID | Capacidade e ator | Regras | Estado e critério verificável |
| --- | --- | --- | --- |
| RF-001 | Usuário entra/sai e mantém a sessão na navegação. | RN-004–005 | C. Anônimo recebe 401; login válido abre apenas empresas autorizadas; logout invalida nova leitura. |
| RF-002 | Administrador cadastra empresa e primeiro gestor. | RN-001–005 | C. Quatro campos (empresa, nome, e-mail e senha do gestor), uma confirmação; repetir a mesma tentativa recupera o resultado sem duplicar empresa/conta. Sem vaga informa impedimento. |
| RF-003 | Gestor cadastra/inativa equipe e define direitos. | RN-002–004 | C. Funcionário sem direito não executa a ação por chamada direta; revogação vale na próxima requisição. Não retirar o último gestor ativo. |
| RF-004 | Atendente consulta, cria e edita clientes. | RN-003,032–034 | C. Busca/paginação; conflito de versão não sobrescreve edição alheia e conserva os campos preenchidos. Cliente cadastrado não ganha login. |
| RF-005 | Atendente cria cliente/técnico/produto no atendimento. | RN-003,018,020 | C nos contextos existentes. Retornar ao formulário principal mantém carrinho/equipamento e seleciona o cadastro concluído; cancelar etapa auxiliar mantém o rascunho anterior. |
| RF-006 | Operador mantém catálogo, custo, venda e estimativas. | RN-006,008,010–013 | C. Custo oculto também no payload sem permissão; preço desconhecido não vira zero; alteração não muda estoque nem vendas passadas. |
| RF-007 | Gestor define preços pendentes em lote. | RN-010–012 | C. Uma gravação do conjunto; exceções manuais preservadas; mudança de versão recusa o lote sem aplicar parte. |
| RF-008 | Estoquista consulta saldos e registra entrada. | RN-008–009,013 | C para quantidades inteiras não serializadas. Referência obrigatória; físico/reservado/disponível coerentes; nova tentativa idêntica não duplica entrada. |
| RF-009 | Operador importa XML e recebe compra na mesma página. | RN-007,014–017 | C no XML suportado. Conhecidos resolvidos juntos; divergências aparecem na linha; parcial respeita restante; financeiro indica não integrado. |
| RF-010 | Sistema reconhece descrições de fornecedores diferentes. | RN-006–007,015 | C assistido. Vínculos compatíveis reaproveitados; atributos conflitantes exigem decisão. Não unir variações pelo nome parecido. PDF/OCR/IA externa: P. |
| RF-011 | Atendente monta venda com vários produtos, desconto por item e condição de pagamento. | RN-018–019,023–024 | C; desconto e seletor unificado locais ainda não publicados. Cliente pesquisado/selecionado em um campo, por nome/telefone/e-mail disponíveis; texto sozinho não confirma identidade. Cada linha mostra quantidade, preço original, desconto opcional em reais e subtotal; resumo bruto/descontos/líquido. Exige `sales.discount`, separado do preço de catálogo. Parcelas usam o líquido. Um cliente e uma confirmação; falha no pagamento recusa também venda/acordo/estoque. |
| RF-012 | Atendente vende para retirada posterior ou entrega imediata. | RN-009,019 | C. Reserva reduz disponível; entrega reduz físico e reserva uma vez, inclusive após repetição. |
| RF-013 | Atendente vende para pagar depois ou entrada + parcelas. | RN-023–025 | C. Vencimentos conferíveis; entrada prometida não recebida; soma exata. Não afirmar crédito aprovado. |
| RF-014 | Técnico/atendente abre e atualiza OS. | RN-020–022 | C. Cliente, técnico e equipamento preservados; sem aprovação não executa; sem testes não fica pronta. |
| RF-015 | Atendente entrega equipamento e consulta sua dívida. | RN-021,028 | C parcial. Financeiro pode mostrar acordo/saldo autorizado, mas ação de entrega ainda exige aceite de ausência de conferência integrada; não anuncia quitação. Decisão automática por saldo/exceção: P. |
| RF-016 | Atendente imprime folha e lê código para abrir OS. | RN-022 | Impressão básica conectada com logo/fundo preparada localmente, não publicada; impressão com código/leitura automática permanecem D e P conectados. Mesma OS ao reimprimir; sem campo dedicado de senha. Leitor/impressora físicos exigem ensaio próprio. [Escopo da personalização](20-personalizacao-da-empresa.md). |
| RF-017 | Técnico registra peças, orçamento revisado e retorno. | RN-020–022 | P. Consumo único por aplicação; nova versão de orçamento preserva anterior e sua aprovação; retorno vinculado à OS original. |
| RF-018 | Operador gera acordo a partir de venda/OS elegível. | RN-024,028 | C. Uma origem/um acordo, OS aprovada, até 36 parcelas; valores e vencimentos validados no servidor. |
| RF-019 | Caixa recebe por cliente, inclusive parcialmente. | RN-025–028 | C. Um pagamento pode abater até 100 parcelas; alocações corretas, um recibo e um movimento; novo clique não recebe de novo. |
| RF-020 | Caixa administra contas e turnos mínimos. | RN-026–027 | C. Conta nova começa em zero; turno próprio/dia válido; fechar conserva diferença e histórico. Sem fluxo completo de contas a pagar. |
| RF-021 | Gestor/caixa consulta extrato de dívidas e recibos. | RN-025–028,035 | C. Separar aberto, vencido e recebido; recibo mantém dados do momento do recebimento mesmo após editar cadastro. |
| RF-022 | Gestor concede limite e controla exposição. | RN-029–030 | P. Saldo confiável por empresa; duas vendas concorrentes não usam o mesmo disponível; exceção tem responsável e motivo. |
| RF-023 | Autorizado consulta CPF/CNPJ em serviço externo. | RN-029–030 | P. Provedor/contrato/finalidade definidos antes; resultado com referência e validade, sem repetir consulta incerta automaticamente; falha não aprova. |
| RF-024 | Gestor trata pagar, estornos, devoluções e outros meios. | RN-016,031 | P. Cada correção preserva original e efeitos vinculados; cartão/cheque distinguem instrumento e liquidação. |
| RF-025 | Autorizado consulta histórico de alterações. | RN-032–033 | C nos módulos auditados. Autor, instante, versão e campos; antes/depois autorizado, sem expor custo/documentos indevidos. |
| RF-026 | Operador filtra e ordena listagens. | RN-034 | C parcial. Operacionais: busca, status, criação/alteração e ordenação aplicáveis. Clientes: busca/paginação, sem atribuir filtros de data/status inexistentes. Financeiro: cliente, situação e conta conforme recurso; não há filtro universal. |
| RF-027 | Gestor emite relatórios e exporta seleção. | RN-035 | D para recebimentos, parcelas, vendas e OS; P conectados. Totais conciliam com origens e permissões; CSV reflete filtros. Resumo financeiro conectado não equivale à paridade completa. |
| RF-028 | Suporte investiga falha por empresa/código. | RN-033,036 | D no diagnóstico local; P para painel central por empresa. Separar auditoria e falha técnica, sem credenciais ou cadastros no log. |
| RF-029 | Operador prepara/acompanha documento fiscal. | RN-017,019,035 | D na simulação; P integração real. Não exibir emissão/autorização real a partir de sucesso simulado. |
| RF-030 | Gestor acompanha parceiros e terceirização. | RN-002,005,022 | P conectado. Cadastro não dá acesso entre empresas; encaminhamento preserva custo/prazo/custódia e direitos. |
| RF-031 | Usuário recupera acesso sem intervenção insegura. | RN-004 | P para convite/recuperação de senha. Identidade comprovada, tentativa limitada e revogação conforme política a definir; não editar senha em tabela nem oferecer cadastro público como recuperação. |

## Requisitos não funcionais

Os requisitos abaixo são exigências ou metas de validação. A coluna de estado explicita o que ainda precisa de comprovação. Não há SLA comercial ou capacidade de produção comprovados pelos testes existentes.

| ID | Qualidade exigida e verificação | Estado/limite |
| --- | --- | --- |
| RNF-001 | **Isolamento e autorização:** testar leitura/escrita direta, troca de empresa e revogação, inclusive retentativas. Sem vínculo/direito não há dados nem efeitos. Banco operacional separado por empresa. | Base C; cobertura por entidade deve acompanhar novos módulos. |
| RNF-002 | **Sessão e segredos:** HTTPS na homologação remota, cookie HttpOnly/Secure/SameSite conforme ambiente, origem permitida para mutações; credenciais fora do código, URL, logs e bundle público. | C no recorte; não constitui auditoria de segurança completa. |
| RNF-003 | **Atomicidade e recuperação:** falhar gravação/auditoria dentro do comando não deixa efeito parcial. Mesma tentativa e conteúdo não duplicam dinheiro/estoque; conteúdo diferente com ID usado é conflito. | C nos comandos cobertos; rascunho não persiste após fechar/recarregar. Cadastro central entre bancos usa intenção recuperável, não transação distribuída. |
| RNF-004 | **Concorrência:** atualizações usam versão; ensaio de disputa da última unidade/mesma parcela admite apenas efeitos válidos. Nenhum sobrescrito silencioso. | C para casos cobertos; teste de capacidade ainda P. |
| RNF-005 | **Precisão:** dinheiro em centavos inteiros seguros; totais/alocações exatos, sem tolerância para esconder diferença. Quantidade/unidade/conversão validadas no servidor. | C no escopo inteiro; quantidades fracionárias P. |
| RNF-006 | **Rastreabilidade:** escrita de negócio auditada com identidade real/instante do servidor, junto do efeito; histórico autorizado preservado sem cópias excessivas de informações pessoais. | C nas entidades auditadas; retenção global e diagnóstico central P. |
| RNF-007 | **Pouco trabalho no caminho comum:** não pedir dado já conhecido, confirmação por item resolvido ou navegação extra para lançar o mesmo fato. Ensaiar o esforço da tabela de jornadas abaixo. | C parcial; medir cada nova jornada, sem ganho de tempo presumido. |
| RNF-008 | **Responsividade:** operar em larguras 320/390/768 e desktop, menu acessível, campos/conteúdo legíveis, sem controles recortados ou rolagem horizontal da página. Tabelas extensas podem ter rolagem própria identificável. | Ensaios anteriores em módulos selecionados; não há certificação de todas as telas/dispositivos. |
| RNF-009 | **Acessibilidade:** campos nomeados, foco visível e recuperado após modal, teclado nos fluxos centrais, erros associados ao contexto e estado além da cor. Validar navegação manual e leitura assistiva antes de ampliar promessa. | Recursos parciais existentes; auditoria integral P. |
| RNF-010 | **Desempenho e rede:** consulta paginada, operações em lote e ausência de chamada por item conhecido. Medir latência por ambiente, volume e estado aquecido/inicial; não transformar observação local em prazo garantido. | Base C; p95, carga simultânea e metas de latência/SLA ainda a definir. |
| RNF-011 | **Falha honesta:** indisponibilidade mantém contexto recuperável, informa erro controlado e não usa dados da demonstração como substituto. Sucesso só depois da confirmação persistida. | C no recorte; não existe modo offline operacional. |
| RNF-012 | **Backup e continuidade:** definir responsável, retenção, exportação autorizada, restauração ensaiada e objetivos de perda máxima de dados/tempo de recuperação antes da produção. | P: nenhuma garantia de recuperação validada por este pacote. Planos gratuitos não comprovam disponibilidade de produção. |
| RNF-013 | **Privacidade e minimização:** dados da empresa só no banco; testes isolados/genéricos. Suporte registra informação técnica mínima; não incluir senha, cookie, documento pessoal ou XML bruto em log geral. | Regra vigente; política completa de retenção/acesso/eliminação ainda deve ser definida. |
| RNF-014 | **Manutenção e qualidade:** testes derivados dos requisitos antes de implementar; falha esperada pertinente, correção e regressão proporcional. Tipos/build aprovados para mudanças de código; migrações explícitas sem apagar histórico. | Processo vigente; alteração documental usa revisão/links, sem simular testes de aplicação. |
| RNF-015 | **Compatibilidade e tempo:** datas/instantes do servidor, UTC e exibição/dia financeiro em America/Sao_Paulo; ensaiar fim do mês e fronteiras de dia. Leitor/impressora não são considerados compatíveis sem teste no hardware usado. | Base temporal C; hardware P. |
| RNF-016 | **Observabilidade:** identificar ocorrência e empresa autorizadamente, separar prontidão central de falha operacional, manter logs sem erro bruto sensível e política de retenção explícita. | Erros controlados C; painel central, alertas e acompanhamento completo P. |

## Jornadas e orçamento de esforço

São critérios do produto, não contagem medida com atendentes. Ações de teclado/cliques, escolha do arquivo no sistema operacional, conferência física, cadastros auxiliares e exceções devem ser contabilizados separadamente. Não atribuir um número fixo de campos a operações cujo conteúdo varia.

| Jornada / quem faz | Dados reaproveitados e digitação necessária | Ações, navegação e rede esperadas | Exceções/limites |
| --- | --- | --- | --- |
| Compra recorrente / estoquista | XML e vínculos fornecem itens, custos e quantidades; nenhuma redigitação de item conhecido. | Escolher arquivo + uma confirmação do conjunto; zero aceite por conhecido; mesma página; um plano + um comando + recarga paginada, sem rede por linha. | Divergência física, unidade ou produto exige decisão; PDF não suportado. Até 500 linhas no recorte. |
| Venda / atendente | Empresa, usuário, preços e saldos reaproveitados; selecionar cliente/produtos, quantidades e condição apenas uma vez. Desconto opcional aparece somente ao pedir na linha. | Uma confirmação principal do conjunto; sem trocar para financeiro/estoque. Quantidade/desconto recalculados localmente, sem rede por item. Um checkout + recargas necessárias; conta/turno auxiliares são exceções medidas à parte. | Crédito não integrado; falha conserva carrinho, desconto e tentativa enquanto aberto. Máximo 100 linhas no comando. |
| Cliente retorna para pagar / caixa | Dívidas e cliente já cadastrados; informar valor, meio, conta e conferências necessárias. | Um pagamento/recibo para várias parcelas; não repetir recebimento por título. Um comando + recargas, sem comando por parcela. | Ajustar alocações quando necessário; conta/turno ausentes resolvidos no contexto. |
| OS com novo cliente/técnico / atendente | Manter equipamento, defeito, prazo e demais campos já preenchidos. | Cadastro auxiliar no contexto e retorno com seleção pronta; zero saída obrigatória para tela de cadastros. Medir chamadas por cadastro, não por campo. | Cadastro auxiliar confirmado continua existindo se depois cancelar a OS. |
| Retirada por código / técnico | Referência da folha identifica a OS; não redigitar nome. | Leitura abre a mesma OS e oferece ação contextual; metas de rede serão definidas na integração conectada. | Apenas D atualmente; aprovação/testes/identificação e decisão financeira continuam necessários. |
| Nova empresa / administrador central | Sessão e capacidade já conhecidas; quatro campos de negócio. | Abrir formulário + uma confirmação; um POST e atualização da lista. Sem escolhas técnicas por empresa no formulário. | Falha mantém tentativa; concluir cadastro pendente solicita senha novamente; sem vaga não cria empresa ativa. |

## Cenários transversais para orientar o próximo desenvolvimento

Use fixtures fictícias independentes; os exemplos abaixo não são registros da conta do usuário. Escrever testes pertinentes antes de alterar comportamento. Não marcar aprovado sem execução.

| ID | Entrada/condição | Resultado esperado | Rastreabilidade |
| --- | --- | --- | --- |
| AC-001 | Visitante tenta cadastrar empresa; gestor comum chama endpoint central. | Negar sem criar conta, empresa ou vínculo. | RF-001–003; RN-001–005 |
| AC-002 | Dois fornecedores equivalentes confirmados entregam 5 e 3 unidades; repetir um recebimento. | Um SKU com acréscimo total 8; repetição sem novo movimento. | RF-008–010; RN-006–017 |
| AC-003 | Duas vendas disputam uma unidade disponível. | Apenas uma confirma; a recusada não deixa dívida, pagamento ou reserva. | RF-011–013; RNF-003–005 |
| AC-004 | Venda fictícia de R$ 1.200, entrada de R$ 300 e três parcelas. | R$ 300 + 3 × R$ 300; sem receber, R$ 1.200 em aberto; recebendo entrada, R$ 900. | RF-011,013,018; RN-023–027 |
| AC-005 | Receber R$ 200 de parcela com saldo R$ 300 e repetir mesma tentativa. | Saldo R$ 100, um recebimento de R$ 200 e um movimento/recibo. | RF-019–021; RNF-003,005 |
| AC-006 | Funcionário sem custo consulta catálogo/histórico e tenta mutação sem direito. | Sem custo no payload e sem efeito indevido, mesmo por chamada direta. | RF-003,006,025; RNF-001–002 |
| AC-007 | OS sem aprovação ou sem testes tenta avançar; entrega permitida sem conferência financeira. | Etapa bloqueada quando falta pré-condição; entrega não declara quitação. | RF-014–015; RN-020–022 |
| AC-008 | Cadastro auxiliar falha ou é cancelado durante OS/venda. | Preservar rascunho principal e seleção anterior; não anunciar cadastro inexistente. | RF-005; RNF-007,011 |
| AC-009 | Tela em 320/390/768px e uso de teclado. | Menu/formulário operáveis, foco e erros compreensíveis, sem campo cortado. | RNF-008–009 |
| AC-010 | Futuras consultas/limite indisponíveis, vencidos ou simultâneos. | Sem aprovação implícita, sem consulta paga repetida automaticamente; carrinho preservado e exposição correta. | RF-022–023; RN-029–030 |

## Próximos recortes e decisões abertas

Proposta de sequência, sujeita à prioridade da operação piloto: **1)** limite/exposição internos apoiados no financeiro já conectado; **2)** impressão/leitor da OS e decisão de entrega com conferência financeira; **3)** relatórios conectados e diagnóstico por empresa; **4)** orçamento versionado/peças, estornos/devoluções e contas a pagar; **5)** integrações externas conforme contratação e necessidade. Fiscal e meios de pagamento exigidos pela loja precisam estar prontos antes de substituir seu processo atual; a sequência não os dispensa.

Definir com o responsável: política de crédito/atraso/exceções; provedor e uso de consulta externa; regras de cancelamento/retorno/garantia; capacidade e suporte esperados; backup/restauração e retenção; quais periféricos e cenários fiscais o piloto realmente exige. Não há data, preço, SLA ou provedor aprovados por este documento.

## Verificação deste pacote documental

Critérios definidos antes da redação: IDs únicos, rastreabilidade RN/RF/RNF, estados coerentes com fontes, links locais válidos, mapa legível e ausência de cadastros/segredos. A criação inicial foi documental; a revisão DSC posterior implementa descontos locais com testes prévios, sem alterar banco da empresa ou serviço publicado. Verificações e limites das duas etapas estão no [registro da equipe](10-equipe-de-agentes.md).

# Regras de negócio do Sistem

Publicação desta revisão conferida em29/10: [evidências e limites](15-auditoria-acessos-e-filtros.md). Registros locais de execução anteriores mantêm seu contexto histórico.

Referência: **29/10/2026**. Público: produto, desenvolvimento, QA e responsáveis pela loja. Este documento consolida decisões já registradas; não altera o comportamento da aplicação. Não contém registros de nenhuma empresa.

Leia também os [requisitos e critérios de aceite](17-requisitos-funcionais-e-nao-funcionais.md), o [mapa mental](18-mapa-mental.md) e o [resumo para o cliente](19-resumo-para-clientes.md).

## Como interpretar

Regra de negócio define o que deve ser respeitado na operação. Requisito funcional define o que o sistema permite fazer; requisito não funcional define a qualidade e os limites dessa execução.

**C — Conectado:** implementado no recorte com API/banco, com evidências anteriores indicadas. **D — Demonstração:** disponível somente no ensaio local em `/demo/`. **P — Pendente:** requisito solicitado ou direção especificada, sem entrega conectada. Uma linha pode separar a parte C da parte D/P. Estado C não significa cobertura de todo o módulo nem liberação para substituir a operação de produção.

Prioridades futuras deste pacote são propostas de organização. Não autorizam contratação, consulta de documentos reais, publicação ou movimentação financeira/fiscal.

## Pessoas, empresas e acesso

| ID | Regra | Estado |
| --- | --- | --- |
| RN-001 | Somente o administrador central cadastra empresas selecionadas e o primeiro gestor. Não há inscrição pública, fila de visitantes ou aprovação de qualquer pessoa que abra o site. | C |
| RN-002 | Cada gestor administra os funcionários e suas permissões somente na própria empresa. Ser gestor não concede administração da plataforma. Administrador central não ganha acesso automático aos dados das empresas que cadastra. | C |
| RN-003 | Cliente consumidor, empresa contratante, conta de acesso e técnico são conceitos diferentes. Cadastrar um consumidor ou técnico não cria login ou senha. Técnico responsável não é necessariamente quem alterou a OS. | C |
| RN-004 | A conta é individual; cada operação exige vínculo ativo com a empresa e direitos atuais. Revogação vale na próxima requisição, inclusive ao repetir um comando antigo. O último gestor ativo não pode ser removido/inativado. | C |
| RN-005 | Dados operacionais pertencem à empresa autorizada. Não reutilizar saldos, vínculos de fornecedor ou histórico de outra empresa. O cadastro central precisa de uma vaga de banco previamente preparada; sem capacidade, informar o impedimento e preservar a tentativa. | C |

## Catálogo, preços e estoque

| ID | Regra | Estado |
| --- | --- | --- |
| RN-006 | Produto identifica um SKU/variação. Nome parecido não prova equivalência: modelo, compatibilidade, material, acabamento, unidade e conversão podem distinguir itens. Descrição original do fornecedor e nome comercial têm finalidades próprias. | C no reconhecimento assistido; interpretação universal/IA: P |
| RN-007 | Um SKU pode ter vários vínculos de fornecedor/código/unidade. Só reaproveitar vínculo compatível; conflito exige decisão. Alterar vínculo não reescreve recebimentos anteriores. | C |
| RN-008 | Cadastrar produto não cria quantidade física. Entrada exige quantidade positiva e referência de origem. Saldo muda por movimento rastreável, não por edição de nome ou preço. | C |
| RN-009 | Disponível = físico − reservado; físico ≥ reservado ≥ 0. Confirmar venda reserva o conjunto; entregar baixa o físico e libera a reserva uma vez. Duas operações não podem consumir a mesma última unidade. | C para itens sem série |
| RN-010 | Custo e preço de venda desconhecidos são pendências, diferentes de zero informado. Preço de venda pendente permite receber mercadoria, mas impede vender. Alteração do catálogo preserva preços e descrições das operações anteriores. | C |
| RN-011 | Lucro estimado unitário = preço de venda − custo de referência; margem estimada = diferença ÷ preço de venda × 100, se venda > 0 e ambos os valores forem conhecidos. Não é lucro contábil, custo médio ou resultado após taxas/impostos. Acréscimo sobre custo não é margem sobre venda. Desconto numa venda reduz sua receita; a estimativa do catálogo não representa automaticamente a margem efetiva dessa venda. | C no catálogo; respeita permissão de custo |
| RN-012 | Precificação em lote preserva exceções manuais e exige conferência do alcance. Custo zero não recebe sugestão percentual automática; mudanças concorrentes exigem nova conferência. Não sobrescrever preços já definidos sem escolha explícita. | C no recorte de lote |
| RN-013 | Unidade serializada precisa de controle individual antes de movimentar/vender. Cadastro com marcação de série não comprova rastreabilidade. Quantidades fracionárias e distribuição de cores sortidas não podem ser inventadas. | Bloqueios C; operação de séries/fracionamento/sortidos: P |

## Compras e reconhecimento de mercadoria

| ID | Regra | Estado |
| --- | --- | --- |
| RN-014 | Ler XML ou cadastrar itens não comprova recebimento físico. A confirmação informa se apenas cadastra ou também registra as quantidades conferidas. Recebimentos parciais respeitam o restante de cada linha e sua conversão. | C |
| RN-015 | Itens já resolvidos são processados em conjunto. Somente ambiguidades, conflitos ou divergências exigem decisão individual. Dados do documento não devem ser redigitados, nem exigir um aceite por item conhecido. | C no XML suportado |
| RN-016 | Reenvio do mesmo recebimento não duplica estoque. Compra registrada manualmente exige conciliação antes de importar de novo. Compras não geram pagamento, saída de caixa ou obrigação a pagar presumidos. | C para proteção do fluxo atual; conciliação manual/importado e contas a pagar: P |
| RN-017 | XML parseável não prova validade fiscal, autorização ou destinatário correto. PDF/OCR e sugestões de IA são evoluções; texto de fornecedor é dado, nunca instrução para executar ações. | Parser C; validação fiscal completa/PDF/OCR/IA: P |

## Vendas e assistência técnica

| ID | Regra | Estado |
| --- | --- | --- |
| RN-018 | A venda escolhe um cliente e confirma vários produtos no mesmo carrinho, com quantidade, preço original, desconto opcional total por linha e subtotal líquido. Itens repetidos somam quantidades e descontos; não transferir abatimento entre produtos. Quantidades, preços e totais são revalidados no servidor. Desconto exige direito próprio e não altera o catálogo. Falha em qualquer efeito transacional recusa o conjunto. | C; desconto publicado em29/10/2026 |
| RN-019 | Fechamento pode coordenar venda, entrega, acordo e entrada efetivamente recebida em uma confirmação, conforme permissões e resumo exibido. Reservar, entregar, receber e emitir documento têm estados próprios. | C no checkout atual; fiscal: P |
| RN-020 | A OS registra cliente, equipamento, problema, responsável e prazo. Aprovação precede execução; testes precedem a condição pronta para retirada. Alteração de valor já aprovado ou com acordo não pode reescrever silenciosamente o contratado. | C; orçamento versionado e evidência completa de aceite: P |
| RN-021 | Entrega de equipamento não comprova pagamento. Atualmente a OS exige aceite explícito de entrega sem conferência financeira integrada, além dos direitos, aprovação e testes. Uma política automática de entrega por saldo/exceção ainda precisa ser implementada. | C para bloqueios/aceite atual; integração da decisão: P |
| RN-022 | Peças aplicadas em reparos devem gerar consumo uma única vez, ligado à OS; equipamento do cliente não é estoque para venda. Imprimir ou reimprimir não cria outra OS. Leitura de código deve localizar a mesma OS quando integrada. Senha de desbloqueio não possui campo dedicado no comprovante; textos livres do atendimento não devem guardar segredos. | Peças/custódia ampliada: P; impressão básica com logo/fundo: C, publicada em29/10; leitor: D, integração conectada P |

## Financeiro e crédito

| ID | Regra | Estado |
| --- | --- | --- |
| RN-023 | Levar hoje e pagar no fim do mês cria entrega e dívida com vencimento escolhido, sem dinheiro recebido. Entrada prometida continua em aberto; só recebimento confirmado liquida valor. | C |
| RN-024 | Entrada + parcelas devem somar exatamente o valor acordado em centavos. O acordo tem uma origem, sem duplicar a dívida por repetir o fechamento. Não assumir dia de vencimento, juros ou encargos não informados. | C; juros/renegociação: P |
| RN-025 | Um recebimento pode abater parcialmente uma ou várias parcelas do mesmo cliente. A soma das alocações coincide com o valor recebido, sem exceder saldos. Distribuição padrão usa as mais antigas; operador pode conferir/ajustar. Excesso não vira crédito silencioso. | C |
| RN-026 | Dinheiro exige turno aberto do próprio operador, no dia financeiro válido. Troco é registrado; somente o valor aplicado entra na conta. Fechamento guarda esperado, contado e diferença, sem fabricar receita para zerar diferença. | C |
| RN-027 | Pix/transferência exigem conta, referência e conferência manual identificada. Agendamento, imagem ou promessa não são confirmação automática. Um pagamento gera recibo, alocações e movimento uma vez. Não há confirmação bancária integrada. | C manual; integração: P |
| RN-028 | OS só origina acordo após aprovação. Recebimentos antigos sem conta/data comprovadas permanecem histórico informado; não inventar caixa ao migrar. Dívida de cliente inativo pode ser recebida. | C no recorte financeiro; migração de legado não automática |
| RN-029 | Crédito próprio deve combinar limite concedido, exposição, atrasos, reservas e eventual consulta externa. Disponível não pode contar duas vezes o mesmo compromisso; entrada apenas prometida não libera limite. | P; parcelas e atrasos financeiros consultáveis C |
| RN-030 | Consulta externa não aprova crédito por si só. Ausência de limite, resultado vencido/desconhecido ou indisponibilidade exigem pendência, preservando carrinho. Exceção terá direito e motivo próprios. À vista não deve exigir consulta de crediário como etapa genérica. | P |
| RN-031 | Cartão, cheque, estorno, reembolso, contas a pagar e conciliação precisam de eventos próprios. Cancelar uma venda não pode apagar pagamento, dívida, estoque ou histórico. Não oferecer esses meios como concluídos sem seus efeitos implementados. | P |

## Histórico, filtros e responsabilidade

| ID | Regra | Estado |
| --- | --- | --- |
| RN-032 | Autor e horário vêm da identidade e do servidor. Escrita e auditoria operacional confirmam juntas. Criação permanece fixa; alteração efetiva muda versão/data. Ler, cancelar, falhar ou repetir comando concluído não cria alteração fictícia. | C nas entidades conectadas auditadas |
| RN-033 | Histórico é preservado; inativação não é exclusão do passado. Valores de custo só aparecem a quem possui direito, inclusive em API/histórico. Diagnóstico técnico e auditoria de negócio são registros diferentes. | C em permissões/auditoria; diagnóstico central por empresa: P |
| RN-034 | Filtros devem corresponder a campos realmente existentes: nome/busca, situação e datas quando suportados. Data de cadastro, alteração, vencimento e recebimento não são intercambiáveis. Ausência de filtro em um módulo não autoriza simular o resultado. | C parcial, conforme RF-026 |
| RN-035 | Relatórios devem separar valor comercial, a receber, vencido e recebido. Exportação respeita seleção/permissões; não somar parcela e recebimento como duas receitas. Fiscal, estoque e caixa não são inferidos do relatório. | D para relatórios completos; resumo financeiro conectado C; paridade P |
| RN-036 | Cadastros, saldos e lançamentos de empresa, inclusive os de teste da conta, ficam somente no banco. Código/documentos/testes não copiam esses registros. Fixtures automatizadas são genéricas e isoladas. | Regra obrigatória do projeto |

## Aplicação e rastreabilidade

### Revisão da rotina e desconto por item — 28/10/2026

**Recorte definido antes do código:** venda única com vários produtos, quantidade e subtotal por linha, desconto opcional em reais sobre o total daquela linha e resumo bruto/descontos/líquido. Não é desconto por unidade; aumentar quantidade mantém o abatimento total informado, sem multiplicá-lo. Itens repetidos podem ser agregados somando quantidades e descontos, sem transferir desconto para outro produto. O servidor usa o preço atual/versionado do catálogo, valida centavos inteiros, desconto entre zero e bruto da linha e recalcula o líquido. Preservar preço original, desconto e líquido no snapshot da venda, sem mudar o catálogo. Acordo e recebimento usam o líquido; checkout com total zero não cria acordo no recorte atual. Produto individual pode chegar a zero se houver outro item com líquido positivo.

Conceder desconto exige `sales.discount`, separado de editar preço do catálogo. Gestor possui o direito; funcionário só por concessão explícita. Revalidar também no replay, sem limites percentuais ou aprovação arbitrários inventados. Desconto altera a operação comercial, sem criar movimento de caixa como se fosse pagamento. A simulação em `/demo/` não recebe paridade automática por esta alteração.

Rotina real: as separações de saldo, recebimento, entrega e fiscal são coerentes com a necessidade da loja, mas não comprovam operação completa nem conformidade. Devoluções/estornos, contas a pagar, peças, custódia e revisão do orçamento continuam lacunas. Confirmar entrega de OS sem conferência financeira é uma limitação atual, não a política comercial definitiva. Validar o processo com atendente, técnico e gestor antes de substituir a operação existente.

Verificação prévia: DSC01–DSC06 backend (múltiplos itens, repetidos, inválidos/forjados, permissão/replay, parcelas/snapshot e item zerado); DSC-UI01–04 (subtotais/um comando, erro/remover desconto, sem direito/editor sem financeiro e mobile/retentativa). DSC-UI05 acrescentou RED do detalhe salvo/legado; DSC07 reproduziu payload malformado antes da correção. Sem digitar desconto por item no caminho comum: um botão expande apenas a exceção. Alterar quantidade/desconto recalcula localmente, sem chamadas de rede; conclusão continua um comando do conjunto e recargas aplicáveis. **Concluído localmente, não publicado**, com testes/revisão e limites no [guia da equipe](10-equipe-de-agentes.md).

Os estados foram confrontados com `server/src/administration.ts`, `accounts.ts`, `permissions.ts`, `operations.ts`, `finance.ts`, os módulos conectados em `src/features` e as evidências abaixo. O documento não transforma restrições atuais em regras comerciais definitivas: entrega financeira da OS e cadastro de empresas por vagas continuam limites explícitos do recorte.

- [Cadastro restrito, auditoria, permissões e publicação](15-auditoria-acessos-e-filtros.md).
- [Financeiro conectado e testes FIN01–FIN26](11-financeiro-primeiro-recorte.md).
- [Crédito combinado: decisões e cenários CR-01–CR-10](09-financeiro-pagamentos-e-fluxo-de-caixa.md).
- [Reconhecimento e recebimento assistido](../../docs/07-cadastro-assistido.md).
- [Diagnóstico e relatórios demonstrativos](12-logs-e-relatorios.md).

Detalhes de vigência fiscal, proteção de dados e contratos de provedores devem ser verificados na implementação correspondente; esta consolidação não é parecer jurídico, fiscal ou contábil.

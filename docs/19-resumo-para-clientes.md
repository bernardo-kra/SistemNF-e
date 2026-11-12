# Sistem — sua loja e assistência no mesmo atendimento

**Desenvolvimento local em12/11 — aguardando publicação:** antes da aprovação, alterar o serviço proposto ou a mão de obra preserva a versão anterior do orçamento. Para registrar a autorização, cliente/serviço/valor já aparecem preenchidos: o atendente informa se foi presencialmente, por WhatsApp, telefone ou e-mail. O sistema registra funcionário, horário e versão; o comprovante identifica o orçamento. Esse registro é o relato do atendimento, sem assinatura digital do consumidor. Após o aceite, serviço/valor ficam protegidos. Peças e renegociação posterior continuam pendentes.

**Novo teste em desenvolvimento local:** na aba **Simulador**, é possível usar uma OS aprovada para experimentar aceite, rejeição e recuperação de uma falha, sem repetir os dados do cliente ou do serviço. Os resultados ficam no histórico e mostram **Simulação — sem validade fiscal**. Nenhuma nota é enviada ao governo; esse recurso não substitui a emissão oficial. Ainda não publicado.

**Fiscal em desenvolvimento local em 09/11:** o painel mostra pendências do cadastro/certificado e mantém emissão oficial indisponível. Transporte de homologação está em protótipo interno; ainda não há nota autorizada por esse fluxo. Faltam A1/dados fiscais confirmados, validações oficiais e conclusão do envio/recuperação. Esta atualização não foi publicada.

Apresentação da versão de testes publicada em **29/10/2026**: [abrir Sistem](https://sistemnf-e.onrender.com/).

O Sistem reúne o atendimento da loja de eletrônicos e da assistência técnica: clientes, produtos, compras, estoque, vendas, ordens de serviço e recebimentos. A proposta é aproveitar o que já foi informado e reduzir a necessidade de trocar de tela ou lançar a mesma informação duas vezes.

## O que você já pode testar

- **Venda com vários produtos:** reunir os produtos e suas quantidades em uma venda, para receber depois, escolher o vencimento ou combinar entrada e parcelas. Entregar o produto e receber o dinheiro são registros separados, mesmo quando feitos no mesmo atendimento.
- **Recebimento de clientes:** consultar parcelas em aberto e vencidas, registrar pagamentos parciais ou pagar várias parcelas com um único recebimento e recibo. Dinheiro usa turno de caixa; Pix e transferência exigem conferência manual.
- **Assistência técnica:** abrir OS, identificar equipamento e técnico, registrar diagnóstico, aprovação, etapas e testes. Cliente ou técnico novo pode ser cadastrado no próprio atendimento.
- **Produtos e estoque:** consultar custo, preço de venda e estimativa de lucro/margem conforme a permissão do funcionário. Controlar o que existe fisicamente, o que está reservado e o que está disponível.
- **Compras por XML:** aproveitar descrições e códigos dos fornecedores, reaproveitar vínculos de produtos e tratar as dúvidas na mesma página. Receber os itens conferidos em conjunto, com proteção contra repetição do mesmo recebimento.
- **Equipe e histórico:** liberar funções por funcionário e consultar quem realizou alterações e quando, nos módulos com histórico implementado.

## Como o acesso é liberado

O acesso é restrito. O administrador do Sistem cadastra a empresa selecionada e seu primeiro gestor. O gestor cadastra os funcionários e escolhe o que cada um pode consultar ou alterar. Não há cadastro público pelo site.

Cadastrar um consumidor em **Clientes**, ou um técnico na OS, não cria conta de acesso. Cada funcionário entra com sua própria conta e vê apenas as empresas e funções autorizadas.

## Três situações do dia a dia

**O cliente leva e paga no fim do mês.** A venda pode registrar a entrega e o vencimento combinado. O valor continua pendente até o recebimento. Não é necessário simular dinheiro entrando no caixa.

**O cliente dá entrada e parcela o restante.** Você confere a entrada, as parcelas e as datas no atendimento. Só o que foi efetivamente recebido aparece como pagamento; promessa de entrada não quita dívida.

**O fornecedor usa outro nome para o mesmo produto.** O sistema reaproveita vínculos já conferidos e apresenta dúvidas reais. Variações incompatíveis não devem ser unidas só porque os nomes são parecidos. Receber a compra atualiza o estoque; apenas ler a nota não confirma que a mercadoria chegou.

## Melhorias publicadas em 29/10

**Desconto opcional em reais por item**, com preço original, subtotal e resumo da venda. O desconto vale para o total daquela linha: duas unidades de R$ 100 com R$ 15 de desconto ficam em R$ 185. O parcelamento usa o valor final; o preço do catálogo permanece igual. Funcionários precisam da permissão concedida pelo gestor.

O cliente da venda e da nova OS é escolhido em **um único campo**: você digita nome, telefone ou e-mail e toca no resultado, sem outra lista de seleção. Cada produto da venda segue o mesmo padrão, com nome, código, preço e saldo disponível quando informado. Cadastrar durante o atendimento mantém os dados preenchidos; um produto novo não substitui outro já escolhido.

Na OS com condições de pagamento registradas e saldo em aberto, **Receber OS** abre o recebimento naquele atendimento, sem procurar o cliente novamente no Financeiro. O saldo atual é sugerido e o pagamento pode ser parcial. Somente parcelas daquela ordem são quitadas; receber não entrega o equipamento. Conferência do meio de pagamento e permissões são preservadas.

**Identidade da loja:** o gestor pode enviar o logotipo e uma imagem de fundo da OS em Configurações → Personalização da loja, ajustar a intensidade e conferir a prévia antes de salvar. O comprovante conectado usa a marca da própria empresa; imagens e ajustes ficam compartilhados no banco da loja.

## O que ainda está em desenvolvimento

**Implementado localmente em 09/11 — aguardando publicação:** o aparelho pode ser recebido com cliente, equipamento e solicitação, deixando técnico, previsão e orçamento pendentes. Técnico é escolhido antes do diagnóstico; quem tem permissão pode atribuí-lo e iniciar a etapa em uma confirmação. Previsão não é preenchida automaticamente. Zero significa serviço gratuito; antes da aprovação é necessário definir o valor. Lista, comprovante e relatório distinguem pendências. Versões do orçamento, peças e registro completo do aceite ainda estão pendentes.

**Implementado localmente em08/11 — aguardando publicação:** devolução de equipamento sem reparo para OS ainda sem aprovação/início/acordo. Selecionar motivo e confirmar a entrega ao cliente conhecido; outra pessoa exige nome/autorização. O registro preserva proposta e histórico, sem cobrar, quitar ou reembolsar. Cancelamento de serviço aprovado/iniciado e diagnóstico cobrável continuam pendentes.

**Preparado localmente em 08/11, aguardando publicação:** relatórios do banco de recebimentos, parcelas, vendas e ordens de serviço, com filtros e CSV. Na OS, os valores de mão de obra aprovada e sem aprovação ficam separados; etapa e valores são os atuais, mesmo ao consultar entradas antigas. Aprovação não é apresentada como pagamento. Não inclui peças nem substitui prestação de contas completa.

A consulta externa de crédito e o limite automático por cliente ainda não estão disponíveis. O sistema já acompanha dívidas e recebimentos, mas isso não representa aprovação automática de crédito.

Relatórios completos, diagnóstico central de falhas, emissão fiscal real e gestão de parceiros ainda precisam de integração. A leitura de código para abrir a OS continua na demonstração, com integração conectada pendente; o novo comprovante personalizado conectado é uma impressão básica, sem essa leitura automática. Peças aplicadas em reparos, orçamento versionado, séries individuais, estornos, contas a pagar, cartão e cheque também têm etapas pendentes.

Na entrega da OS, a versão atual exige confirmação explícita de entrega sem conferência financeira integrada. Não interprete essa ação como quitação. Lucro/margem do produto são estimativas antes de taxas, impostos e outras despesas.

**Revisão da rotina em08/11:** ainda é necessário completar situações comuns: devolver equipamento sem reparo após recusa do orçamento, distinguir preço desconhecido de serviço gratuito, registrar versões do orçamento/aceite e tratar estornos, devoluções e ajustes de inventário/caixa. A entrada mínima da OS, eventual venda avulsa e a política de retirada a prazo precisam ser definidas com a loja. Essa revisão não mudou o aplicativo nem liberou uso como sistema completo de produção. [Detalhes e prioridades](16-regras-de-negocio.md#revisão-de-aderência-à-rotina--08112026).

## Como avaliar a versão de testes

Use [o Sistem online](https://sistemnf-e.onrender.com/) com sua conta liberada. Confira uma compra, uma venda a prazo, um recebimento e uma OS, observando se os dados ficam preservados e se as permissões estão adequadas à equipe. As condições de suporte, recuperação e capacidade precisam ser definidas antes de substituir os processos da loja.

A área **Explorar demonstração** usa exemplos separados no navegador; seus resultados não são os dados compartilhados da empresa. Integrações bancárias/fiscais e leitura por equipamentos físicos não estão comprovadas por uma simulação. Não há prazo comercial de conclusão assumido nesta apresentação.

[Ver mapa do produto](18-mapa-mental.md) · [Consultar regras e limites](16-regras-de-negocio.md)

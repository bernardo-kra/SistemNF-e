# Eficiência para quem usa o Sistem

Estudo aplicado em **28/10/2026**, a partir da solicitação do usuário. Objetivo: orientar decisões de produto e revisão, sem confundir software rápido com trabalho rápido para a pessoa. Fontes primárias abaixo; as aplicações ao Sistem são decisões propostas de projeto. Não houve entrevista ou medição de produtividade com atendentes reais.

## O que estamos avaliando

O NN/g distingue facilidade de aprender, eficiência após aprender, retomada de uso, erros/recuperação e satisfação. Isso orienta medir a tarefa e sua correção, além da quantidade de cliques. Uma interface simples também precisa resolver a necessidade real. [Usability 101](https://www.nngroup.com/articles/usability-101-introduction-to-usability/).

No Sistem, o critério é conseguir concluir corretamente o atendimento com pouca digitação, busca, espera e retrabalho. Uma etapa que parece curta, mas exige lembrar códigos, procurar a origem ou corrigir lançamentos duplicados, pode aumentar o esforço total. Contagem de cliques é um indício, não uma prova isolada.

## Princípios que serão usados na revisão

| Princípio | Aplicação ao Sistem | Verificação esperada |
| --- | --- | --- |
| Informar uma vez | Reutilizar cliente, empresa, produto, preço, origem e valores válidos no mesmo atendimento. | Não pedir nova busca do cliente ao receber uma OS já selecionada. |
| Reconhecer em vez de lembrar | Mostrar nome, contato, modelo, unidade e diferenças relevantes nas opções. | Homônimos e variações não são escolhidos automaticamente por semelhança. |
| Trabalho por tarefa | Organizar Vender, Receber, Entregar e Receber compra pelo resultado desejado. | Uma confirmação pode coordenar efeitos autorizados, com alcance visível, sem recadastrar o fato em cada módulo. |
| Caminho comum curto | Processar itens conhecidos em conjunto; mostrar exceções quando necessárias. | Sem aceite por item de XML conhecido; desconto e divergência aparecem no contexto. |
| Controle e recuperação | Preservar rascunho em falhas, explicar conflito e permitir retomar sem duplicar efeitos. | Timeout não apaga carrinho nem vira sucesso; repetição mantém a tentativa. |
| Resposta perceptível | Mostrar busca, processamento e conclusão de forma compreensível. | Campo continua editável durante busca; impressão espera imagens; sucesso só após confirmação do servidor. |
| Consistência | A mesma tarefa usa termos e interações previsíveis entre telas. | Busca e escolha no mesmo campo; resultados atuais, teclado e toque com o mesmo significado. |
| Correção antes de atalho | Manter conferências necessárias a dinheiro, estoque e identidade. | Menos telas não transforma entrada prometida em pagamento, importação em recebimento ou nome parecido em mesmo SKU. |

Reconhecimento, consistência, estado visível, controle e prevenção/recuperação de erros derivam das heurísticas do NN/g; a tabela traduz essas direções para o produto, sem afirmar que houve validação por usuários. [Heurísticas de usabilidade](https://www.nngroup.com/articles/ten-usability-heuristics/).

A WCAG 2.2 trata da entrada redundante no mesmo processo: dados já informados devem ser reaproveitados ou estar disponíveis para seleção, com exceções por necessidade, segurança ou informação que perdeu validade. Isso não exige guardar rascunhos entre sessões nem autoriza misturar empresas. [W3C — Redundant Entry](https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html).

## Velocidade da interface e tempo da operação

INP mede resposta visual às interações; a referência publicada pelo web.dev para boa resposta é até200ms no percentil75, separado entre móvel e computador. Essa referência não é prazo de conclusão de uma venda, do banco ou de upload, nem resultado já medido no Sistem. [web.dev — Optimize INP](https://web.dev/articles/optimize-inp).

Medir separadamente: reação visual, consulta no servidor, confirmação persistida e tempo total do atendimento. Buscar em lote e reutilizar resultados pode reduzir esperas; cache precisa respeitar empresa, versão, permissões e dados que perderam validade. Exibir sucesso antecipadamente em recebimento/estoque pode causar erro operacional.

## Como comparar antes e depois

Usar a mesma tarefa, quantidade de itens e dados fictícios, declarando ambiente, dispositivo, rede, estado inicial e experiência da pessoa. Separar ensaio automático de observação real. Uma média rápida entre quem concluiu não deve esconder abandonos ou erros.

| Medida | O que registrar |
| --- | --- |
| Conclusão correta | Tarefa concluída com cliente, quantidades, valores e efeitos corretos; tentativas e desistências separadas. |
| Esforço | Campos digitados novamente, escolhas, cliques/toques/teclas e trocas de tela/contexto. |
| Espera | Intervalos sem resposta, tempo de busca, confirmação e tarefa completa; medições inicial/aquecida separadas. |
| Erros e recuperação | Seleção incorreta, dado perdido, correção, necessidade de ajuda e repetição sem duplicação. |
| Rede | Chamadas por operação, por item e repetidas sem necessidade; tamanho dos dados/imagens recebidos. |
| Percepção do operador | Se entende a próxima ação, o resultado e o que falta; dificuldade relatada e sugestões observadas. |

Ainda não há linha de base de produtividade humana nem promessa de economia de tempo. Os testes existentes comprovam comportamentos delimitados e geometria; não substituem observação no balcão.

## Exemplos e prioridades atuais

1. **Venda:** campos únicos de cliente e produto implementados localmente, ainda não publicados. Produto separa o cache dos itens escolhidos dos resultados atuais; pesquisa, desconto e cadastro contextual preservam as outras linhas. [Execução PSEL](14-cadastros-no-contexto.md).
2. **OS:** seleção única de cliente e recebimento contextual de parcelas da própria ordem implementados localmente. Receber requer acordo existente, confirmação do meio e permissão; não entrega equipamento nem quita outras dívidas. Próximos recortes: distinguir orçamento indefinido de serviço gratuito e aplicar política de entrega. Não eliminar aprovação/testes para encurtar o fluxo.
3. **Compra:** importar o conjunto, decidir somente ambiguidades e confirmar quantidades físicas sem redigitar o XML. Separação de efeitos não exige uma tela por módulo.
4. **Pagamento:** conservar conta compatível ao mudar Pix/transferência; valor, conta e conferência continuam explícitos. Não confirmar crédito bancário por inferência.
5. **Personalização:** logo/fundo pré-visualizados em memória, um salvamento do conjunto, erro recuperável e edição encerrada também quando o servidor confirma uma operação sem mudança de versão. Não baixar fundo nas telas que só usam logo.

Os problemas confirmados, oportunidades e limites estão na [auditoria de jornadas](14-cadastros-no-contexto.md). Os critérios rastreáveis permanecem nos [requisitos](17-requisitos-funcionais-e-nao-funcionais.md). Este estudo não autoriza implementar todo o backlog; cada correção exige cenário e teste prévios pertinentes.

# Equipe de agentes do Sistem

**Versão 1.3 — 18/10/2026.** Guia de trabalho de sete papéis, incorporando o prompt mestre, o complemento e a regra de definir testes antes do código solicitada pelo usuário. Preserva o produto Sistem NF-e, Next.js e os três perfis originais, acrescentando orquestrador, arquiteto, revisor e especialista sob demanda. O primeiro anexo terminava incompleto na seção de frontend; o complemento posterior define as especializações agora incorporadas.

Os perfis são configurações locais de agentes do Codex para desenvolver o projeto. Não são usuários do ERP nem agentes embarcados no produto. O guia não inicia processos permanentes, não retreina modelos e não implementa funcionalidades sozinho.

## Produto e estado efetivo

O Sistem é um SaaS para lojas de eletrônicos e manutenção de TI: vendas, OS, clientes, produtos, estoque, financeiro e fiscal. A direção é uma base de código, assinatura mensal e banco operacional separado por empresa. Parceiras são empresas independentes; cadastrá-las não concede acesso a outro tenant.

A implementação atual é um protótipo Next.js/React/TypeScript/CSS, com exportação estática e armazenamento no navegador. Backend Node.js e PostgreSQL são direção arquitetural; API, banco, autenticação, permissões e isolamento reais ainda precisam ser implementados. Confirme o estado no [README](../README.md), nos manifestos e no código antes de repetir esta descrição.

O [primeiro recorte financeiro](11-financeiro-primeiro-recorte.md) cobre acordos, parcelas, recebimentos manuais, recibos e turno mínimo. O [financeiro ampliado](09-financeiro-pagamentos-e-fluxo-de-caixa.md) continua como planejamento. Fiscal simulado não comprova emissão ou conformidade. Preserve operação, pagamento, liquidação, caixa, fiscal, estoque e custódia como dimensões próprias. Legado de OS não gera movimento de caixa com conta ou data inventadas.

## Papéis e responsabilidade integrada

| Responsável | Responsabilidade | Resultado esperado |
| --- | --- | --- |
| `orquestrador` / agente principal | Classificar a tarefa, delimitar escopo, selecionar papéis, resolver dependências, distribuir arquivos, integrar e conferir a entrega. | Plano aplicado, decisões fundamentadas, estado atualizado e resultado integrado. |
| `analista` | Investigar a necessidade da loja, definir regras, caminho comum, exceções e critérios antes dos testes e da implementação. | Especificação do menor recorte coerente, com premissas e esforço do atendente identificados. |
| `arquiteto` | Avaliar estrutura, tecnologias existentes, dados, contratos e integrações; comparar alternativas relevantes. | Arquitetura e plano técnico proporcionais, com compatibilidade, custos e riscos explícitos. |
| `desenvolvedor` | Implementar frontend, domínio, persistência e integrações atribuídas depois de definidos os testes, preservando dados e contratos. | Código sustentável, recuperação de erros, migração quando necessária e verificações pertinentes. |
| `qa` / QA e Segurança | Definir testes pelos requisitos antes da implementação; depois confrontar o comportamento e investigar integridade, permissões, segurança, acessibilidade e esforço operacional pertinentes. | Cenários e resultados esperados prévios, testes executados, achados reproduzíveis e parecer independente limitado ao escopo verificado. |
| `revisor` | Examinar diff, contexto, integração e contratos; distinguir defeitos bloqueadores de melhorias opcionais. | Revisão fundamentada com impacto, evidências, recomendações e limitações. |
| `especialista` | Investigar um problema delimitado de UX/UI, dados, APIs, acessibilidade, infraestrutura, desempenho ou outra especialidade atribuída. | Diagnóstico para decisão ou implementação explicitamente autorizada, com impactos e verificação. |

O agente principal continua responsável pela orquestração e integração. Pode acumular decisões arquiteturais rotineiras; aciona o arquiteto quando houver uma decisão estrutural relevante. O desenvolvedor cobre frontend/backend conforme a tarefa. QA e revisor podem dividir a avaliação: execução de cenários e inspeção contextual do código, respectivamente. Não duplicar a mesma revisão sem um risco ou objetivo diferente.

Um papel é uma responsabilidade; um perfil é um conjunto de instruções; uma sessão de agente é uma execução real. Sete perfis disponíveis não significam sete sessões iniciadas. Reutilize agentes existentes com a especialização explícita quando adequado, respeite o limite efetivo de concorrência e mantenha a revisão independente de quem implementou. Tarefas simples podem ser resolvidas diretamente.

O desenvolvedor não se aprova em nome do QA. O QA pode reprovar e o analista pode contestar requisitos. Revisões de maior risco precisam de avaliação independente; não transforme todo ajuste de texto em uma cerimônia de três agentes.

## Configuração e pontos de entrada

Os perfis versionados ficam em [orquestrador.toml](../.codex/agents/orquestrador.toml), [analista.toml](../.codex/agents/analista.toml), [arquiteto.toml](../.codex/agents/arquiteto.toml), [desenvolvedor.toml](../.codex/agents/desenvolvedor.toml), [qa.toml](../.codex/agents/qa.toml), [revisor.toml](../.codex/agents/revisor.toml) e [especialista.toml](../.codex/agents/especialista.toml). Cada arquivo define nome, descrição e instruções. Modelo, esforço e permissões permanecem herdados da sessão; não modificar configurações globais para cumprir uma tarefa local.

Nesta workspace, `D:\SistemNF-e` contém a especificação, enquanto `D:\SistemNF-e\web` é o repositório Git da aplicação. Há cópias idênticas dos perfis em `.codex/agents` dos dois diretórios. Ao editar os perfis, sincronize e verifique os sete pares. A cópia em `web` é versionável e pode ser reutilizada ao clonar o repositório.

O formato segue a [documentação oficial da OpenAI sobre subagentes](https://learn.chatgpt.com/docs/agent-configuration/subagents), consultada em 17/10/2026. Instruções de somente leitura são regras de atuação; não constituem uma sandbox separada. Descoberta de perfis depende do cliente/contexto e não foi comprovada só por salvar os arquivos. Se necessário, o coordenador passa as instruções explicitamente ao iniciar uma tarefa e registra esse método.

Não presumir que editar um perfil atualiza as instruções de agentes já iniciados. Na próxima atribuição, o coordenador fornece o protocolo atualizado aos agentes existentes quando necessário, sem criar agentes adicionais apenas para recarregar o texto.

O agente principal recebe a coordenação de `AGENTS.md`; salvar `orquestrador.toml` não o substitui automaticamente. Se esse perfil for iniciado como subagente, coordena somente o recorte delegado e reporta ao principal, sem criar uma segunda direção concorrente. Cada atribuição deve fornecer as instruções globais aplicáveis e a especialização do papel, usando apenas ferramentas efetivamente disponíveis. Leitura de documentos, Git, terminal ou runner são meios possíveis, não promessas de capacidade no cliente.

Para reutilizar o método em outro repositório, adapte contexto, stack, caminhos, comandos e papéis necessários depois de inspecionar esse projeto. Não copie as regras fiscais/financeiras do Sistem como requisitos universais. Esta entrega mantém a configuração local; não instala um pacote global nem cria um projeto novo.

## Fonte de verdade e documentação

A instrução atual do usuário e as autorizações registradas delimitam o trabalho. Para determinar o estado do projeto:

1. Código, configuração e execução observada mostram o comportamento implementado.
2. Requisitos explicitamente aprovados mostram o comportamento esperado.
3. Contratos e decisões registradas explicam a implementação e seus limites.
4. Documentação antiga e hipóteses precisam ser confrontadas com essas evidências.

Uma divergência deve ser investigada e corrigida: código existente não autoriza ignorar requisito aprovado. Nunca invente arquivos, endpoints, normas, dependências, resultados de testes ou validação com usuários. Use [Certeza], [Provável] ou [Chute] quando a distinção for relevante; hipóteses não se tornam decisões comerciais por repetição.

Reaproveite os documentos existentes. Os caminhos abaixo partem da raiz da workspace completa; `docs/01` a `docs/07` ficam fora do Git da aplicação. Em um clone contendo apenas `web`, registre sua ausência e consulte o responsável quando forem essenciais; não simule leitura nem crie cópias divergentes.

| Assunto | Registro existente |
| --- | --- |
| Produto, requisitos e prioridades | `docs/01-produto-e-pesquisa.md`, `docs/02-fluxos-e-requisitos.md`, `docs/05-backlog-e-qa.md` |
| Arquitetura, entidades e contratos futuros | `docs/03-arquitetura-e-contratos.md`; tipos e operações efetivos em `web/src/lib` |
| Interface e acessibilidade | `docs/04-design-system.md` e componentes efetivos |
| Decisões, fontes e pendências | `docs/06-fontes-e-decisoes.md` e relatório da tarefa |
| Fiscal e financeiro | `web/docs/08-etapa-fiscal-e-proximos-passos.md`, `web/docs/09-financeiro-pagamentos-e-fluxo-de-caixa.md`, `web/docs/11-financeiro-primeiro-recorte.md` |
| Verificações e comandos | `web/README.md`, `web/tests`, `web/checks` e relatório da tarefa |
| Coordenação e estado resumido | Este guia; detalhes/evidências permanecem no documento responsável pela tarefa |

Não criar `PROJECT.md`, `API.md`, `STATUS.md` ou outros arquivos vazios só para reproduzir o modelo recebido. Um documento novo deve resolver uma necessidade que os registros existentes não atendem. Segurança deve ser tratada no requisito, no código e na verificação aplicáveis; o nome de um arquivo não comprova proteção.

## Autonomia e limites

Dentro da tarefa autorizada, a equipe pode investigar, editar os arquivos atribuídos, implementar, testar, corrigir e documentar sem pedir confirmação para cada escolha técnica. Pergunte apenas quando faltar informação essencial; continue trabalho independente enquanto aguarda. Não infira preço, comissão, juros, política de crédito, reembolso ou configuração tributária para preencher uma lacuna.

Publicação em produção, despesas e operações destrutivas com ambientes ou dados reais exigem autorização explícita do usuário. Verifique as autorizações já registradas: quando cobrirem a mesma ação e suas condições, não peça novamente. Alterar audiência ou permissões externas não é consequência automática de publicar. Perfis não concedem autorização, e o coordenador não pode ampliá-la por conta própria.

Não expor credenciais, enviar mensagens externas, efetivar operação fiscal/bancária, descartar trabalho do usuário ou desativar verificações para forçar aprovação. Não adicionar infraestrutura, dependências ou abstrações sem necessidade demonstrável. Preserve a stack funcional; use a menor solução que satisfaça os requisitos.

## Ciclo de execução

1. **Enquadrar:** classificar como descoberta, planejamento, implementação, correção, revisão ou manutenção; ler instruções aplicáveis, estado e diff.
2. **Delimitar:** identificar problema, critérios de aceite, exclusões, riscos e responsáveis. Para mudanças de jornada, incluir o esforço do atendente.
3. **Investigar e combinar:** distribuir investigações independentes; definir tipos, contratos, migrações e arquivos antes de trabalhos dependentes.
4. **Definir e executar os testes primeiro:** derivar cenários e resultados esperados dos requisitos; escrever os testes pertinentes e executá-los antes de alterar o comportamento. Confirmar a falha esperada para funcionalidade ausente ou defeito.
5. **Implementar:** desenvolver o menor recorte que satisfaça os requisitos e testes definidos, tratando falha e recuperação; comunicar descoberta que altere escopo ou contrato.
6. **Verificar e corrigir:** executar novamente os testes e a regressão proporcional ao risco; pedir revisão independente quando justificada. Refatorar mantendo os testes aprovados e repetir somente os checks afetados por mudança, falha ou preocupação concreta.
7. **Integrar e registrar:** conferir os critérios, atualizar documentação/estado e entregar resultado, evidências e pendências. Publicar somente dentro da autorização aplicável.

Não é obrigatório formalizar sete etapas para uma edição simples. A verificação deve ser definida antes da alteração, com esforço proporcional ao risco.

### Testes antes do código

Esta é a ordem obrigatória para funcionalidades e correções, inclusive quando o coordenador executa uma tarefa sem subagentes:

1. O analista, ou o responsável pela tarefa simples, define o comportamento esperado e critérios observáveis a partir dos requisitos. O código existente é consultado para entender contexto e contratos; não determina o resultado esperado.
2. O QA, quando acionado, define os testes de forma independente antes da implementação. Registra precondições, entradas, ações, resultados esperados e sua relação com os critérios, incluindo caminho comum, limites e falhas relevantes. Os valores esperados vêm das regras e de exemplos verificáveis, sem copiar o algoritmo que será implementado. Em tarefas sem QA separado, o responsável mantém essa ordem e declara a ausência de avaliação independente.
3. O responsável pelos arquivos de teste escreve a automação pertinente e a executa antes de alterar o comportamento. Em bugs, o teste deve reproduzir o defeito; em funcionalidades novas, deve revelar o comportamento ausente. A falha deve ter a causa esperada: erro alheio de sintaxe, configuração ou infraestrutura não comprova o defeito. Se um cenário já passar, registre que o comportamento já era atendido, sem inventar uma falha. Se a execução estiver impedida, registre o motivo e a ausência de confirmação prévia; testes definidos/escritos não equivalem a testes executados.
4. O desenvolvedor implementa o comportamento e executa novamente os testes definidos. Refatorações preservam os resultados e a cobertura; cenários adicionais descobertos durante o trabalho complementam os anteriores.
5. O QA executa a avaliação final independente quando atribuído, confrontando os requisitos originais, os cenários prévios e a entrega. Não remover testes, enfraquecer expectativas, ignorar casos ou alterar dados apenas para obter aprovação. Mudança explícita de requisito ou erro demonstrado no próprio teste permite correção justificada, registrada e revisada de forma independente quando o QA estiver atribuído.

Em refatorações, registre e execute primeiro os testes que preservam o comportamento aprovado. Para documentação e ajustes visuais sem automação útil, defina previamente a inspeção ou o cenário manual e aplique-o após a edição; não crie testes artificiais apenas para cumprir o rito. Essa proporcionalidade não dispensa testes de regras de negócio ou de comportamento verificável automaticamente.

Registre no documento existente da tarefa os cenários ou referências aos testes antes da implementação; depois acrescente os comandos, a falha inicial observada (ou a razão de sua ausência), o resultado após a alteração e as limitações. O coordenador informa a dependência desses testes ao delegar a implementação. Investigações independentes podem ocorrer em paralelo, mas o código de comportamento aguarda a definição dos testes.

### Seleção de papéis por situação

| Situação | Estratégia |
| --- | --- |
| Funcionalidades independentes | Investigar ou implementar em paralelo, com arquivos distintos e dentro da capacidade disponível. |
| Módulos dependentes | Arquiteto/coordenador e responsáveis combinam contratos antes de trabalhos dependentes. |
| Mesmo arquivo | Um responsável por vez; os demais investigam ou aguardam a interface necessária. |
| Decisão estrutural relevante | Arquiteto analisa alternativas; orquestrador decide a integração e registra o motivo. |
| Bug confirmado | Definir e executar o teste que reproduz o defeito antes da correção; desenvolvedor corrige; QA verifica os cenários afetados e a regressão pertinente. |
| Defeito de segurança | Priorizar comunicação e contenção dentro da autorização, depois correção e verificação; não testar destrutivamente em produção. |
| Mudança de risco relevante | QA verifica comportamento e/ou revisor examina código de forma independente, com perguntas distintas quando ambos participarem. |
| Conhecimento especializado necessário | Especialista recebe área, problema, arquivos, restrições e critérios explícitos. |
| Requisito ambíguo | Perguntar se a lacuna mudar uma decisão essencial; continuar investigação independente. |
| Teste indisponível | Registrar o impedimento e reduzir o nível de confiança, sem declarar aprovação integral. |
| Ação irreversível ou fora da autorização | Preparar o resultado revisável e solicitar apenas a autorização ainda necessária; preservar dados e trabalho existentes. |

### Início de um projeto novo

Somente quando o usuário solicitar um projeto novo: entender problema/usuários/restrições; definir escopo e aceite com o analista; comparar tecnologias e estrutura mínima com o arquiteto; preparar execução, configurações e verificações necessárias; construir incrementalmente; validar, documentar e entregar. Não aplicar essa sequência como justificativa para reiniciar um projeto existente. O Sistem permanece em evolução incremental.

## Delegação, comunicação e conflitos

Uma atribuição deve ser suficiente para o agente trabalhar sem adivinhar o escopo. Modelo, condensável em uma mensagem para tarefas pequenas:

```text
ID / tipo da tarefa:
Objetivo e problema da loja:
Contexto / comportamento atual / fontes:
Responsável:
Escopo permitido e arquivos exclusivos:
Exclusões / restrições / autorizações aplicáveis:
Dependências / contratos a preservar:
Critérios de aceite:
Verificações exigidas:
Testes/cenários prévios e resultados esperados / responsável / evidência antes de implementar:
Resultado e documentação esperados:
```

Um único responsável por conjunto de arquivos de cada vez. Investigações podem ocorrer em paralelo; implementações dependentes aguardam os contratos e testes necessários. Combine servidor, porta e artefatos de teste, encerrando apenas os processos iniciados pela própria tarefa.

Agentes podem discutir diretamente regras, alternativas, contratos e achados dentro do escopo. Registre decisões significativas e mantenha o coordenador informado. Cada discordância deve trazer evidência, impacto, alternativa e verificação possível. O coordenador resolve escolhas técnicas rotineiras; dúvidas de negócio ou ações fora da autorização seguem para o usuário.

Se houver conflito, interrompa apenas as alterações conflitantes, preserve o trabalho e reconcilie antes de continuar. Não resolver conflito com reset destrutivo, remoção recursiva, alteração global ou force push. Não distribuir a mesma implementação a dois agentes para depois escolher um resultado.

## Contrato de entrega e conclusão

```text
Status: concluído | parcial | bloqueado | falhou
Resumo: resultado efetivamente produzido
Alterações: arquivos, comportamentos e decisões
Verificações: testes/cenários definidos antes do código, execução prévia, resultado após a alteração e limitações observadas
Pendências: critérios não atendidos e problemas não resolvidos
Riscos: impactos relevantes e limites da avaliação
Dependências: o que é necessário para continuar
Documentação: registros criados ou atualizados
```

Esses são estados de tarefa para comunicação. Não alteram automaticamente metas ou estados da plataforma. Uma tarefa de QA concluída pode ter parecer **Reprovado** ou **Verificação parcial**; conclusão da avaliação não significa aprovação do produto.

Defeitos registram gravidade justificada, arquivo/local, precondições, reprodução, esperado, observado e evidência. O parecer do QA é **Aprovado no escopo verificado**, **Reprovado** ou **Verificação parcial**. Não aprovar porque o desenvolvedor informou sucesso; build não substitui comportamento observado.

Concluir exige avaliar os critérios de aceite, executar verificações aplicáveis, registrar falhas/limitações, manter contratos/documentação consistentes e reconhecer os bloqueios críticos. Quando uma verificação não for possível, declare a limitação sem aprovação integral. Não remover teste, enfraquecer expectativa ou ocultar falha para produzir sucesso.

## Critério obrigatório: trabalho do atendente

Para cada jornada nova ou alterada, analista e desenvolvedor devem responder: quem executa, em qual situação, o que já está no sistema, quais dados precisam de entrada manual e quais lançamentos decorrem do fato informado. O QA percorre o caminho comum e uma recuperação de erro relevante.

- Reaproveitar dados conhecidos; não pedir novamente o que pode ser obtido com segurança da operação e do contexto.
- Gerar os efeitos de domínio correspondentes uma única vez, preservando as regras de estoque, caixa e fiscal. Uma mesma confirmação pode produzir registros distintos sem obrigar o operador a cadastrá-los separadamente.
- Manter o contexto ao validar, corrigir ou abrir uma etapa necessária; evitar obrigar o atendente a recomeçar uma operação.
- Usar padrões justificados, visíveis e alteráveis. Conta padrão não significa crédito bancário confirmado; usuário autenticado só pode fornecer autoria quando existir identidade real.
- Mostrar campos de exceção quando necessários. Pagamento parcial, vencimento individual e divergência não devem dominar o caminho comum.
- Registrar ações, campos digitados, mudanças de tela e retrabalho em cenários reproduzíveis quando isso ajudar a avaliar o fluxo. Tempos e ganhos só são relatados se medidos, com condições explícitas; não impor metas numéricas inventadas.
- Separar correção funcional, inspeção de usabilidade e validação com atendentes reais. Playwright aprovado não comprova produtividade no balcão.

A abertura de caixa no recebimento foi implementada no recorte ABR, com estado e evidências no [documento financeiro](11-financeiro-primeiro-recorte.md). Receber à vista na venda e pagar várias parcelas juntas continuam propostas de evolução. **A adaptação dos perfis não autoriza completar todo o financeiro.**

## Como pedir

Exemplo de implementação delimitada:

> Use a equipe para simplificar o recebimento à vista dentro da venda. O analista define o caminho comum e exceções; o QA define os testes de integridade, repetição, recuperação e esforço do atendente antes da implementação; o desenvolvedor implementa o recorte acordado; o QA executa a verificação final independente.

Exemplo de revisão sem alteração:

> Peça ao analista e ao QA uma revisão crítica do recebimento mensal. O desenvolvedor deve somente mapear arquivos e dependências. Tragam passos repetidos, evidências e a menor melhoria coerente.

São instruções ao coordenador, não comandos de terminal. A execução depende das ferramentas e permissões efetivamente disponíveis.

## Estado resumido e próxima prioridade

| Item | Estado conhecido | Evidência / pendência |
| --- | --- | --- |
| Equipe de sete perfis | Os sete papéis participaram da rodada de 18/10/2026: principal na orquestração e seis subagentes acionados em etapas. | Instruções fornecidas explicitamente nas atribuições; entregas e limites registrados abaixo. A descoberta automática dos perfis pela IDE continua sem comprovação. |
| Testes antes do código | Regra incorporada às instruções, ao ciclo e aos sete perfis em 18/10/2026. | Definir expectativas pelos requisitos e executar os testes pertinentes antes da implementação; verificar novamente após a alteração, sem enfraquecer testes para obter sucesso. |
| Primeiro recorte financeiro | Implementado e verificado nos cenários registrados. | [Decisões e evidências](11-financeiro-primeiro-recorte.md); não repetir o parecer antigo como se fosse nova execução. |
| Simplificação do balcão | Abertura contextual de caixa implementada e verificada. | Recorte ABR no documento 11: testes antes do código, 15 novos casos aprovados, regressão completa, revisão independente e build. Receber diretamente na venda e várias parcelas juntas permanecem pendentes. |
| Diagnóstico e relatórios | Diagnóstico local e quatro relatórios implementados e verificados pela equipe. | [Escopo, testes e limites](12-logs-e-relatorios.md): código de ocorrência, exportação JSON controlada e relatórios de recebimentos, parcelas, vendas e OS com CSV. Coleta centralizada por assinante depende do backend e da identidade de empresa. |
| Backend, acesso por empresa e integrações | Pendentes. | Confirmar contratos, identidade, autorização, transações e isolamento antes de operação real. |

Atualize a linha pertinente ao concluir uma tarefa; mantenha resultados detalhados no relatório responsável. Criar o guia não inicia automaticamente a próxima implementação.

## Primeira rodada — 17/10/2026

Os tres agentes foram iniciados nesta sessao com as instrucoes de seus perfis passadas explicitamente. Cada um concluiu uma tarefa de diagnostico somente leitura. A criacao da equipe nao modificou funcionalidades da aplicacao.

- **Analista:** recomendou iniciar por acordo de pagamento e parcelas de vendas/OS, com soma exata, vencimentos validos, persistencia e tratamento do legado. Identificou uma dependencia a resolver antes de receber em dinheiro: a especificacao exige turno aberto em F1, mas posiciona turnos em F3. Antecipar o turno minimo ou adiar esse recebimento no primeiro recorte.
- **Desenvolvedor:** mapeou `FinancePage`, `receivePayment`, tipos, persistencia/migracao e resumos da OS/painel. Confirmou que o vencimento hoje mostrado no financeiro vem da previsao da OS, sem uma parcela financeira propria. Preservar os valores antigos sem fabricar conta, data ou movimento de caixa e revisar os consumidores de `.received` na implementacao.
- **QA:** conferiu os campos e delimitadores dos perfis, igualdade das copias e separacao das responsabilidades. Nao encontrou defeito estrutural. Prioridades futuras: migracao sem caixa ficticio, diferenca entre pagamento e liquidacao e testes de parcelas/centavos/datas/duplicidade. Esses riscos nao foram apresentados como funcionalidades testadas ou homologadas.

**Verificacao realizada:** tres pares de perfis identicos, campos obrigatorios preenchidos, documentacao e links locais conferidos. O QA nao encontrou parser TOML completo instalado; a validacao foi estrutural. Descoberta automatica dos arquivos pelo cliente nao foi testada. Nao foram executadas suites/build do produto nesta rodada, pois nao houve mudanca de codigo funcional.

## Rodada de implementacao financeira — 17/10/2026

A pedido do usuario, os tres agentes discutiram e executaram o [primeiro recorte financeiro](11-financeiro-primeiro-recorte.md). O analista definiu regras e criterios; o desenvolvedor implementou dominio, migracao e persistencia; o QA escreveu e executou verificacoes independentes. O coordenador integrou as telas e os consumidores de saldo, fez revisao e verificou o artefato de producao.

As decisoes conjuntas anteciparam um turno minimo para aceitar dinheiro, mantiveram valores legados sem caixa ficticio e limitaram Pix/transferencia a credito conferido manualmente. A revisao corrigiu a cronologia entre gravacao e restauracao, a atualizacao da data financeira na virada do dia e a visibilidade da acao Receber no celular. Resultados e pendencias estao registrados no relatorio, sem tratar a simulacao como integracao real.

## Adaptação do guia de trabalho — 17/10/2026

**Status: concluído no escopo documental e de configuração.** O usuário confirmou a adaptação do material de Guia Virtual à equipe do Sistem NF-e, preservando produto e Next.js. Foram atualizados este guia, as instruções dos dois pontos de entrada da workspace, o README da aplicação e os três perfis com suas cópias sincronizadas. O coordenador realizou a adaptação e a verificação; não houve uma nova rodada de QA do produto.

Verificações realizadas: três pares de perfis idênticos; sintaxe restrita ao formato TOML de três campos usado pelos perfis, com delimitadores/controles conferidos; UTF-8 dos dez arquivos alterados; 12 links locais existentes; bloco gerado de instruções Next.js preservado; `git diff --check` aprovado. Essa conferência não é um parser TOML geral nem um teste de descoberta automática no cliente.

Nenhum código de aplicação, dependência ou configuração global foi alterado. Não houve nova execução de testes funcionais/build, pois esta entrega modifica instruções e documentação. As melhorias de balcão permanecem pendentes de implementação e validação; os resultados financeiros anteriores continuam registrados na rodada correspondente.

## Complemento de especializações — 17/10/2026

**Status: concluído no escopo documental e de configuração.** O segundo material foi incorporado em sete perfis locais: os três originais foram complementados e foram criados orquestrador, arquiteto, revisor e especialista. O guia define entradas, entregas, critérios, seleção por situação, evolução de projeto existente e descoberta de projeto novo. O coordenador continua sendo o agente principal; perfis adicionais são usados conforme a necessidade, sem iniciar todos por rotina.

Verificações finais: sete pares de perfis idênticos; estrutura TOML restrita aos três campos usados; presença de instruções globais, especialização e contrato de entrega; UTF-8 de 19 arquivos; 37 links locais existentes; bloco gerado do Next.js preservado; mudanças restritas a documentação e perfis. A checagem inicial de presença encontrou duas formulações equivalentes da hierarquia de instruções; a redação dos novos perfis foi padronizada e a conferência foi repetida com aprovação. `git diff --check` também foi aprovado.

Não foi usado parser TOML geral nem comprovada a descoberta automática dos novos perfis no cliente. Nenhuma nova sessão de agente foi iniciada nesta adaptação; a execução anterior do núcleo de três agentes permanece como evidência da rodada financeira, não como teste das quatro especializações novas. Não houve alteração de aplicação, instalação global, nova dependência, teste funcional ou build nesta etapa.

## Rodada conjunta — 18/10/2026

**Status: concluído no escopo de auditoria e planejamento.** A pedido do usuário para colocar todos para trabalhar, o principal exerceu a orquestração e iniciou seis subagentes com tarefas delimitadas e instrução para ler seus respectivos perfis, AGENTS.md e este guia. Foram usados até três subagentes simultâneos, em etapas, sem iniciar um segundo coordenador. A rodada foi de auditoria do estado atual e preparação da próxima entrega; não implementou o backlog.

| Papel / tarefa | Entrega da rodada |
| --- | --- |
| Orquestrador / coordenação | Delimitou objetivo e arquivos, coordenou dependências e runner exclusivo do QA, selecionou o menor recorte e consolidou evidências nos documentos existentes. |
| Analista / EQ-20261018-AN | Definiu abertura de turno dentro do recebimento, invariantes, exclusões e cenários ABR-01 a ABR-06 antes do código. Identificou frase desatualizada no documento 09. |
| Arquiteto / EQ-20261018-AR | Mapeou contratos e separação de estados; apontou limites de persistência local e riscos da futura composição venda/acordo/pagamento, sem apresentá-los como defeitos reproduzidos. |
| QA / EQ-20261018-QA | Executou tipos e suíte atual; mapeou os testes prévios da melhoria e acrescentou a exceção de turno do dia anterior. Parecer limitado à base existente. |
| Desenvolvedor / EQ-20261018-DEV | Confirmou viabilidade com comandos existentes e preparou plano de alteração do PaymentModal, preservando rascunho e confirmação financeira separada. Não implementou. |
| Especialista UX / EQ-20261018-UX | Mapeou troca de contexto e repetição no cenário existente; definiu critérios de foco, teclado e celular para uma etapa no mesmo diálogo. Inspeção estática, sem ensaio de produtividade. |
| Revisor / EQ-20261018-REV | Revisou independentemente contratos, riscos e consolidação documental. Acrescentou o cuidado com o fechamento nativo do diálogo por Escape; o plano e ABR-03 incorporam essa restrição. Baseline não equivale a aprovação da nova jornada. |

**Evidências de execução do QA:** `npm.cmd run typecheck` aprovado; `npm.cmd test` aprovado em uma execução com três checks estáticos e 54 testes Playwright, sem falhas ou casos ignorados. O servidor iniciado pelo runner foi encerrado. Não houve novo build ou alteração de código/testes; os cenários ABR ainda não foram escritos ou executados.

**Próxima entrega preparada:** abrir turno no contexto do recebimento em dinheiro, preservando dados e sem receber automaticamente. Diagnóstico, critérios prévios, limites e plano estão no [documento financeiro](11-financeiro-primeiro-recorte.md). Receber na venda e várias parcelas juntas continuam evoluções posteriores.

Foi corrigida nas duas cópias do documento 09 a afirmação de que a tela atual só considera OS. Verificação documental realizada pelo coordenador: UTF-8 e controles dos quatro documentos alterados, igualdade das cópias do documento 09, sincronização dos sete pares de perfis, 20 links locais dos documentos 10/11 existentes e `git diff --check` aprovado. A revisão distinguiu testes executados dos cenários apenas planejados. Acionamento explícito por tarefa não comprova descoberta automática dos perfis pela IDE.

## Implementação da abertura contextual — 18/10/2026

**Status: concluído no escopo ABR-01 a ABR-07.** Após autorização do usuário para executar o plano, o coordenador acionou QA, desenvolvedor e revisor, com arquivos exclusivos. Não foi necessário repetir a análise nem iniciar todos os papéis. QA escreveu os testes primeiro e só então o desenvolvedor recebeu liberação para alterar o produto.

- **QA / ABR-QA:** criou `tests/finance-cash-opening.spec.ts` com 15 casos. Antes do código: dez falhas esperadas e cinco aprovados. Depois da implementação, detectou saída do foco por Tab e um erro de preparação do ensaio ABR-01. O estado inicial deste teste passou a ser capturado após a hidratação preexistente, antes da abertura, mantendo todas as igualdades; coordenador e revisor conferiram a justificativa. A expectativa que detectou a falha de foco foi preservada.
- **Desenvolvedor / ABR-DEV:** implementou a abertura no mesmo PaymentModal, rascunho preservado, operador separado, recebimento com confirmação própria, cancelamento contextual e tratamento do turno anterior. Corrigiu o ciclo de Tab/Shift+Tab com base no teste que falhou. Alterações de produto restritas a `src/features/finance/page.tsx` e propriedades opcionais de eventos em `src/components/ui.tsx`.
- **Revisor / ABR-REV:** conferiu testes prévios, contratos, alteração justificada do ensaio e diff final por leitura, sem editar ou executar o runner. Parecer aprovado no escopo de revisão estática, sem bloqueio aberto; avaliação funcional permaneceu com o QA.
- **Coordenador:** controlou a dependência entre testes e código, integrou documentação/READMEs e executou o build após encerramento dos servidores do QA. Preservou as alterações existentes; não houve commit, publicação, integração externa ou mudança de configuração global.

**Verificação final:** 15 novos testes aprovados; regressão única com três checks estáticos e 69 testes Playwright aprovados, sem falhas ou casos ignorados; tipos aprovados pelo desenvolvedor e build aprovado pelo coordenador, com 17 páginas estáticas. O QA verificou também teclado nas duas direções e 390 × 844 em Chrome, gerando duas capturas. Parecer: **Aprovado no escopo verificado da simulação local**.

Decisões, cenários, comandos, resultados, limites e capturas estão no [documento financeiro](11-financeiro-primeiro-recorte.md). Receber diretamente na venda, pagamento conjunto e fechamento contextual de turno continuam fora desta entrega. Testes de domínio para repetição/conflito local não comprovam coordenação entre abas ou transação de servidor.

## Diagnóstico e relatórios — 18/10/2026

O usuário esclareceu que os problemas devem ser relacionados à empresa assinante e priorizou recebimentos, parcelas, vendas e OS. Analista e arquiteto definiram o recorte compatível com a aplicação estática: diagnóstico da instalação local, sem apresentar o UUID do navegador como empresa autenticada. QA definiu e executou os testes antes da implementação. Dois desenvolvedores receberam arquivos exclusivos de domínio e interface; o coordenador integrou o armazenamento, os comandos, a navegação e a documentação.

QA acumulou a revisão independente do produto. A conferência de precisão encontrou uma diferença de um centavo na apresentação de um valor alto: um novo teste reproduziu a falha antes da correção e depois confirmou linha, total e CSV exatos. Ajustes demonstrados de preparação dos ensaios preservaram as expectativas e estão justificados no documento da tarefa.

**Verificação funcional:** 27 novos casos aprovados; regressão única com três checks estáticos e 96 testes Playwright aprovados, sem falhas ou casos ignorados. Capturas, tipos, build, contratos, limitações e conclusão são registrados em [Diagnóstico e relatórios](12-logs-e-relatorios.md). Não houve publicação ou integração externa; o monitoramento central por empresa continua pendente.

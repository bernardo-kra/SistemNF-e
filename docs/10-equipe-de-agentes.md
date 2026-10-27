# Equipe de agentes do Sistem

**Continuidade de publicação em 27/10/2026:** usuário autorizou commit/push e execução online. Instâncias locais encerradas; homologação Render Free/Neon publicada e validada por Chrome/HTTPS com a empresa real informada pelo usuário, sem dados financeiros fictícios. Backend completo 110/110 e build aprovados; frontend 251 cenários únicos em rodadas. Revisor independente encontrou e conferiu correção do GTIN ambíguo e do orçamento de conexão após 503 no Render. Testes RED/GREEN pertinentes e 12 checks após esse ajuste passaram; o teste final online aprovou login, cookie, reload, produtos, financeiro, privacidade e logout. Código publicado `d3f36cb`. Evidências e histórico de falhas/correções no [documento 13](13-backend-primeiro-recorte.md). Registros de preparação com publicação pendente abaixo são checkpoints anteriores.

## Registro resumido — Neon/Render, 27/10/2026

**Status: implementação e verificação do recorte concluídas; publicação no Render pendente.** Coordenador definiu aceite/testes antes do código, implementou host Node para export+API, preparação dos bancos remotos e primeiro gestor explícito. Usuário confirmou manter Better Auth e usar PostgreSQL Neon. Revisor independente `revisao_neon` fez leitura sem editar arquivos ou acessar segredos/serviços; apontou recuperação do marcador, conferência do destino do gestor e risco de omitir dependências de build. Correções tiveram testes RED/GREEN e reinspeção independente sem novas pendências nesses pontos. A execução dos testes foi do coordenador, sem apresentar isso como QA independente de toda a aplicação.

Resultado: instalação/build/tipos aprovados; 250 cenários frontend e quatro checks; 12 casos rápidos de configuração/bootstrap/host/destino e três cenários PostgreSQL de preparação/primeiro gestor/recuperação aprovados em rodadas. Smoke real Chrome→API compilada→PostgreSQL Neon passou login/reload, produto/auditoria, leitura em outro navegador, bloqueio de funcionário e logout. Bancos QA são separados dos bancos da aplicação; nenhum gestor fictício foi inserido no banco da empresa. Sem commit/push ou novo deploy no Render. Comandos, falhas recuperadas e limites no [registro Neon](13-backend-primeiro-recorte.md); preparação e configuração no [guia da API](../server/README.md#neon-e-render-homologação). Esse parecer não encerra a revisão financeira/operacional anterior.

**Versão 1.3 — 18/10/2026.** Guia de trabalho de sete papéis, incorporando o prompt mestre, o complemento e a regra de definir testes antes do código solicitada pelo usuário. Preserva o produto Sistem NF-e, Next.js e os três perfis originais, acrescentando orquestrador, arquiteto, revisor e especialista sob demanda. O primeiro anexo terminava incompleto na seção de frontend; o complemento posterior define as especializações agora incorporadas.

Os perfis são configurações locais de agentes do Codex para desenvolver o projeto. Não são usuários do ERP nem agentes embarcados no produto. O guia não inicia processos permanentes, não retreina modelos e não implementa funcionalidades sozinho.

## Produto e estado efetivo

O Sistem é um SaaS para lojas de eletrônicos e manutenção de TI: vendas, OS, clientes, produtos, estoque, financeiro e fiscal. A direção é uma base de código, assinatura mensal e banco operacional separado por empresa. Parceiras são empresas independentes; cadastrá-las não concede acesso a outro tenant.

A interface atual é um protótipo Next.js/React/TypeScript/CSS, com exportação estática e armazenamento no navegador. A primeira fundação Node.js/PostgreSQL implementa API, autenticação, vínculos e isolamento por empresa em desenvolvimento local, ainda independente das telas. Painel de funcionários, permissões configuráveis e integração operacional continuam pendentes. Confirme o estado no [README](../README.md), nos manifestos e no código antes de repetir esta descrição.

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
| Fundação do backend | API, identidade, bancos por empresa, clientes e auditoria implementados e verificados localmente. | [Estado, testes e limites](13-backend-primeiro-recorte.md). O checkpoint de 19/10 era somente preparação. Telas operacionais demonstrativas ainda independentes. |
| Controle de funcionários, auditoria operacional e filtros | Painel real ACC entregue para equipe e direitos de clientes; demais módulos operacionais pendentes. | [Execução, 55 casos backend em rodadas, 11 UI, smoke real e limites](15-auditoria-acessos-e-filtros.md). Usuário escolheu login real e dados compartilhados; abas demonstrativas não são protegidas por esse painel. |
| Cadastros no contexto | Implementados em OS, venda e catálogo, com técnico operacional persistente e entrada explícita quando falta estoque. | [Decisões, testes e evidências](14-cadastros-no-contexto.md): testes antes do código, 23 novos cenários, regressão de 119 casos, tipos/build e QA independente aprovados. |
| Preços em lote e pendência no contexto da venda | Implementados e verificados em 24/10/2026 no protótipo local. | [Cadastro assistido da workspace](../../docs/07-cadastro-assistido.md): critérios LPR, 21 novos cenários, regressão de 191 casos, três checks estáticos, tipos/build e QA independente aprovados. Demais lacunas estão no [backlog atualizado](../../docs/05-backlog-e-qa.md). |
| Carrinho com vários produtos | Implementado e verificado em 24/10/2026, com cliente global e cadastros por linha. | [Fluxo da venda na workspace](../../docs/02-fluxos-e-requisitos.md): critérios CAR, 25 novos cenários, regressão de 216 casos, tipos/build e QA independente aprovados; confirmação/entrega duráveis e repetíveis sem duplicação. |

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

## Análise de nomes e vínculos de produtos — 23/10/2026

**Status: concluído no escopo de análise; implementação pendente.** O coordenador inspecionou a importação atual e extraiu localmente as descrições do PDF fornecido pelo usuário, sem enviar o arquivo a serviço externo. A proposta de catálogo com atributos, vários códigos de fornecedores por SKU, revisão contextual e recebimento sem duplicação está no [documento de cadastro assistido da workspace](../../docs/07-cadastro-assistido.md#nomes-diferentes-para-o-mesmo-produto--análise-de-23102026), no diretório `docs` fora do repositório Git `web`.

Foram definidos os cenários NOM-01 a NOM-11 antes de qualquer implementação. São cenários planejados, sem testes funcionais escritos ou executados nesta análise. A verificação desta entrega limita-se ao conteúdo, UTF-8, links locais e whitespace dos documentos; não houve alteração de código ou nova execução de suíte/build. Vínculos completos, extração de atributos, PDF e recebimento de compra por item permanecem pendentes; a aplicação atual apenas cria cadastros sem saldo na importação XML.

## Revisão de esforço operacional — 23/10/2026

**Status: concluído no escopo de requisitos; implementação pendente.** O usuário rejeitou o custo de campos, cliques e esperas por item e manteve obrigatórias precisão de estoque e prestação de contas. O coordenador confirmou por inspeção que a importação atual pede preço de venda para cada produto novo e possui uma segunda tela de revisão. Não foi realizado benchmark da aplicação.

O [cadastro assistido da workspace](../../docs/07-cadastro-assistido.md) substitui o fluxo proposto por uma página, resolução em lote, decisões apenas sobre exceções, preço de venda pendente separado do recebimento e coordenação dos efeitos autorizados sem lançamento repetido. NOM-08 foi esclarecido por essa mudança de requisito; foram definidos USO-01 a USO-10 antes de código. Os critérios incluem esforço, integridade e medição de desempenho, sem prometer tempos ainda não medidos. O documento 02 e as duas entradas AGENTS.md incorporam a orientação; os perfis de agentes não mudaram.

Verificação desta revisão: coerência entre fluxo e critérios, UTF-8, controles, links locais, whitespace, sincronização das novas regras entre as duas entradas e preservação do bloco Next.js. Nenhuma implementação, alteração de teste automatizado, nova suíte/build ou integração foi realizada; não há ganho de cliques ou de desempenho comprovado no produto por esta revisão documental.

## Folha da OS e acesso por leitor — 23/10/2026

**Status: concluído no escopo de análise; implementação pendente.** O usuário propôs apresentar a folha da OS na retirada e ler seu código para localizar e atualizar o atendimento. O coordenador conferiu o detalhe por identificador e as ações existentes; a aplicação ainda não gera comprovante com código nem captura a leitura. A [proposta na workspace](../../docs/02-fluxos-e-requisitos.md#folha-da-os-e-atendimento-por-leitura-de-código--proposta-de-23102026) define Salvar e imprimir sem redigitação, abertura direta, entrega contextual, exceções de retirante e pendências, referência sem dados pessoais e separação da senha do aparelho. O design system aponta para os mesmos critérios.

LEI-01 a LEI-11 foram definidos antes de código; continuam cenários planejados, sem testes funcionais executados. Conferência documental: UTF-8, links, controles, whitespace e coerência entre jornada e critérios. Não houve implementação, nova suíte/build, impressão ou ensaio com hardware. Tempos, legibilidade física e compatibilidade com o leitor da loja não foram medidos; sessão, isolamento e operador autenticado continuam dependências do backend.

## Implementação de importação e atendimento por código — 23/10/2026

**Status: concluído no recorte local, com QA independente.** Após autorização para desenvolver e retomada solicitada pelo usuário, a equipe executou duas frentes com arquivos exclusivos: desenvolvedor de compras em `purchases/` e `xml-import.tsx`, desenvolvedor de OS em `service-orders.tsx`, `order-code.ts` e `order-receipt.tsx`, QA nos testes/evidências e coordenador no domínio compartilhado, persistência, venda, estilos e documentação. Sessões interrompidas por limite foram retomadas com novos responsáveis sobre o estado preservado; nenhum trabalho anterior foi descartado.

Os testes precederam o comportamento: rodada pura inicial e RED de navegador liberaram implementação por conjunto. Casos adicionais reproduziram defeitos antes das correções. A fronteira de escrita dos dois casos de fingerprint e ajustes legítimos de harness estão descritos no [registro de execução de compras da workspace](../../docs/07-cadastro-assistido.md#execução-e-evidências--23102026). As interações antigas de importação e OS foram revistas antes das novas telas pelos requisitos USO/LEI, mantendo os resultados de negócio.

**Resultado final:** 45 novos cenários (28 domínio, 17 navegador); `npm.cmd test` com 164 testes Playwright e três checks estáticos aprovados, sem falhas/ignorados; tipos e build aprovados pelo coordenador. QA aprovou funcionalidade e revisão independente; o desenvolvedor da OS revisou separadamente as mudanças do coordenador em store/restauração/elegibilidade, sem aprovar sua própria UI. Ajuste exclusivamente visual posterior foi reinspecionado em 1440/390 px: campos de no mínimo 44 px e zero transbordamento. O servidor iniciado pelo QA foi encerrado antes do build.

Importação em lote: três ações na aplicação e zero ações por linha para itens conhecidos. Em uma amostra Chrome local, 50 itens levaram 93/63 ms para resumo/gravação e 500 levaram 69/90 ms; sem navegação ou chamadas de backend. Leitura simulada da OS levou 58 ms. Não são garantia de produção, comparação de produtividade ou ensaio de hardware. Capturas: [Importação desktop](evidencias/importacao-lote-desktop.png), [Importação mobile](evidencias/importacao-lote-mobile.png), [OS com leitor](evidencias/os-leitor-entrega.png), [Comprovante](evidencias/os-comprovante-impressao.png) e [PDF A4 demonstrativo](evidencias/os-comprovante-demonstrativo.pdf).

Limites e pendências de produção permanecem explícitos: backend/auth por empresa, validação fiscal, PDF/OCR/IA externa, contas a pagar, recebimento de séries/cores e hardware físico. Compras não fabricam pagamentos e entregas não quitam saldo. A versão local 3 e os históricos anteriores foram preservados. Não houve publicação, integração externa, alteração global ou commit nesta rodada.

Hashes SHA256 finais dos testes verificados:

```text
intelligent-browser.spec.ts BBBFD26A01519945FD042B09EB72FD8DF87E01F9C89718B8FF4C482BC022625E
intelligent-purchases.spec.ts B5764E7250A695024B978A3A93535A7A3E0FAE86DB7078E2F76D425271E92EAF
intelligent-orders.spec.ts 28441FA7126491ECFCEBFBFD236C5D67E196C309B83D57D73B92D042473A3C39
intelligent-helpers.ts CA69787C5AC43A9BD7012BAA39C0F994010DD34D768B64FD8215C0DBBC3DE75C
prototype.spec.ts 4FB561E7A5C1A00567D9071DD0B54C9F964627D92CC381D5A24ADA60B6FE70D7
```

Conferência final do coordenador: UTF-8 e controles de 40 arquivos textuais, 83 links locais existentes e novas âncoras válidas, cinco hashes de testes conferidos, sete pares de perfis idênticos, bloco gerado Next.js preservado e `git diff --check` aprovado. As capturas finais das duas jornadas também foram inspecionadas pelo coordenador. Documentação principal de requisitos permanece no diretório `docs` da workspace, fora do Git de `web`, conforme os links acima.

## Preços e lucro estimado no catálogo — 23/10/2026

**Status: concluído no protótipo local, com QA independente.** O coordenador definiu o recorte no [documento dos cadastros no contexto](14-cadastros-no-contexto.md): preço de compra e venda visíveis, cálculo por unidade e margem sobre a venda, sem novas etapas. QA escreveu e executou seis cenários antes do produto; seis falhas pertinentes liberaram a implementação pelo coordenador em componente compartilhado, editor, lista e CSS. A interação de um helper existente mudou de `Custo de referência` para `Preço de compra` pelo requisito explícito, sem alterar valores ou expectativas de domínio.

Seis novos testes aprovados em 7,5 s; regressão única com **170 testes Playwright e três checks estáticos aprovados**, sem falhas ou ignorados, em 1,7 min. QA revisou o código independentemente e conferiu 1440/390 px, teclado, preço pendente, centavos, zeros, prejuízo, cancelamento e persistência sem alterar estoque/histórico. Coordenador inspecionou as três capturas e aprovou tipos/build depois que o servidor QA foi encerrado. Hashes, capturas, observações de resposta e limites estão no documento da tarefa.

O cálculo não exige botão, digitação de lucro, navegação ou chamada de backend. Compra usa a referência já cadastrada; a estimativa antecede impostos, taxas e despesas e não é lucro contábil. Não houve mudança de schema/store, dependência nova, commit ou publicação.

## Continuidade das funcionalidades faltantes — 24/10/2026

**Status: concluído o recorte LPR, com QA independente.** O coordenador confrontou as docs com o código e registrou as lacunas no [backlog da workspace](../../docs/05-backlog-e-qa.md). Priorizou a precificação em lote, já prevista no cadastro assistido, e a resolução do preço pendente durante a venda. Implementou somente após os cenários prévios do QA: 13 de domínio e oito de navegador; 13 falhas pertinentes e oito negativos inicialmente satisfeitos pelo erro dos stubs, sem tratar estes últimos como validação funcional.

QA reproduziu um defeito de foco na primeira entrega e manteve a expectativa; a correção após abertura nativa do diálogo foi verificada no mesmo teste. Regressão única: **191 testes Playwright e três checks estáticos aprovados**, sem falhas ou ignorados, em 2,0 min. Tipos e build aprovados pelo coordenador após encerramento do servidor QA. As três capturas foram inspecionadas por ambos. Hashes, critérios, execução e limites estão no [cadastro assistido](../../docs/07-cadastro-assistido.md).

Ensaio Chrome local com 50 produtos: um percentual e uma confirmação para o conjunto, sem decisões por item; três ações principais incluindo abrir o lote, uma escrita, zero navegações/fetch. Observações de 49/88 ms para prévia/gravação incluem automação e não representam SLO ou ganho validado. No celular há rolagem horizontal para as colunas e vertical para a confirmação, também disponível por Enter.

Lote e cadastro individual de produto gravam antes de anunciar sucesso; falha preserva rascunhos e preços, sem efeito em estoque, operações anteriores ou dinheiro. Sem mudança de schema/versão local, dependência nova, commit, publicação ou integração externa. Ao final daquela rodada, vendas com vários itens, peças/versões de OS, séries, devoluções, financeiro ampliado, parceiros persistentes e backend permaneciam pendentes; a entrega posterior do carrinho está registrada abaixo.

## Carrinho de venda e reserva do conjunto — 24/10/2026

**Status: concluído no recorte local, com QA independente.** O usuário aprovou a recomendação de vender vários produtos em um pedido. Coordenador definiu CAR-01 a CAR-10 no documento 02; QA reutilizado manteve autoria dos novos testes e revisão independente. Gate prévio: 25 cenários, 15 falhas pertinentes e dez negativos satisfeitos pelo erro dos stubs, sem aprovação funcional desses negativos. O reforço do ID da tentativa foi escrito/repetido antes da nova UI.

Coordenador implementou domínio, store durável, editor de carrinho, integração da tela, foco por linha e CSS. QA conferiu reserva/baixa do conjunto, idempotência, snapshots, falhas de gravação, cadastros/preço/entrada no Item 2 e efeitos no financeiro/fiscal simulado/relatórios. Ajuste de harness escopou o alerta operacional ao `main`, distinguindo o announcer vazio do Next, sem remover mensagem ou invariantes.

**Validação:** 216 testes Playwright e três checks estáticos aprovados, sem falhas/ignorados, em 2,4 min; 191 casos anteriores preservados. Após refinamento exclusivamente CSS para compactar três itens no desktop, CAR-B01/B02 e a inspeção desktop/mobile passaram sem repetir toda a regressão. Tipos e build aprovados pelo coordenador depois do servidor QA ser encerrado; as duas capturas finais também foram inspecionadas pelo coordenador.

Ensaio de três produtos: um cliente e uma confirmação, dez ações de controle contando seleções/quantidades/adicionar linhas, nenhuma gravação por item, navegação ou fetch, uma escrita local. Observações de 18/30 ms para recálculo/gravação incluem automação e não constituem SLO. Desktop exibe os três itens, total e confirmação sem rolagem; celular conserva rolagem interna e confirmação por teclado. Métodos, hashes e capturas no [registro da venda](../../docs/02-fluxos-e-requisitos.md).

Sem mudança de schema/versão, dependência, commit ou publicação. Backend, séries individuais, cancelamento/devolução e orçamento versionado com peças da OS permanecem pendentes. A próxima recomendação é desenvolver orçamento versionado e reserva/consumo de peças respeitando a autorização, sem reescrever a aprovação anterior.

## Identidade real e equipe conectada — 25/10/2026

**Status: concluído no recorte de fundação e ACC; solicitação operacional ampliada parcial.** A escolha explícita do usuário por login real/dados compartilhados priorizou backend e contas. Coordenador manteve configuração, ferramentas, UI e documentos; desenvolvedor recebeu API/fontes de autorização; QA manteve testes e revisão independente. Os requisitos foram definidos nos documentos 13/15. A criação de funcionário usa SDK e intenção recuperável, sem incorporar conta alheia; vínculo/auditoria transacionam juntos. Permissões atuais de clientes são revalidadas a cada requisição; último gestor protegido na concorrência.

Testes prévios e limites do protocolo (incluindo três testes UI complementares sem RED prévio comprovado) registrados no documento 15. QA reproduziu os defeitos de migração, schema, relógio de teste, recuperação, foco, resposta atrasada, filtros entre sessões e edição em voo antes das correções pertinentes. Backend: 55 cenários únicos aprovados em rodadas, não uma única suíte final de 55. Frontend: regressão 226 mais três checks estáticos; após ajuste isolado, 11 testes da área, tipos e build passaram. Smoke real Chrome→cookie→API→PostgreSQL aprovou cadastro e efeito de conceder/revogar direitos sem novo login. Builds/tipos aprovados; sem fontes de saldo parcialmente migradas ou publicação.

Evidências e parecer independente no [recorte ACC](15-auditoria-acessos-e-filtros.md); preparação explícita do primeiro gestor no [guia da API](../server/README.md). Próxima prioridade: integrar os módulos operacionais de forma coerente para entregar histórico/autoria, metadados e filtros de produtos/OS/compras e aplicar os demais direitos de domínio. Uma pasta temporária ignorada foi preservada após rejeição automática da exclusão recursiva; o banco foi encerrado, sem contornar a política.

## Operação conectada — 26/10/2026

**Status: implementação e validação automática local concluídas; revisão independente pendente.** O usuário pediu continuar o trabalho autorizado. Análise inicial delimitou produto/estoque/venda/OS/compra com uma única fonte de saldo. Os agentes de análise/QA ficaram indisponíveis por limite de uso antes de escrever testes; o coordenador assumiu testes prévios, implementação, integração e documentação. Essa verificação não conta como revisão independente.

Contratos, TDD, correções justificadas de fixtures, comandos e resultados finais estão no [registro OP](15-auditoria-acessos-e-filtros.md). A área `/operacao/` usa login real e direitos por ação, reaproveita cadastro contextual e processa XML/preços em lote. Demonstração permanece independente e preservada. Não houve publicação, migração de dados reais, efeito financeiro/fiscal ou mudança dos sete perfis de agentes. Próximas lacunas: revisão independente, paridade da OS com impressão/leitor, peças e orçamento versionado; financeiro/relatórios conectados precisam de recorte próprio.

Verificação: 76 casos únicos de backend aprovados em rodadas (55 anteriores e 21 operacionais); rodada final web de 236 casos mais três checks estáticos; tipos/builds aprovados. Smoke real Chrome/cookie/PostgreSQL aprovou contexto de OS, saldo/reserva/baixa, XML500 com um plano/uma confirmação, restrição de custo, revogação e logout. Nenhuma navegação de documento após login; medições locais e limites no documento 15. A regressão encontrou e corrigiu consulta SQL e seletor ambíguo, sem enfraquecer expectativas. OP17 é cobertura complementar sem RED prévio comprovado, limite do protocolo registrado.

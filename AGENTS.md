<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Equipe do Sistem

Os sete perfis `orquestrador`, `analista`, `arquiteto`, `desenvolvedor`, `qa`, `revisor` e `especialista` estao em `.codex/agents`. Leia `docs/10-equipe-de-agentes.md` para responsabilidades, fluxo e limites. Quando o usuario pedir a equipe, o agente principal coordena: analista define o recorte, QA define os testes antes do codigo, desenvolvedor implementa os arquivos atribuidos e QA verifica a entrega de forma independente. Acione arquiteto, revisor e especialista conforme a necessidade; nao inicie todos por rotina. Investigue em paralelo apenas o que nao depende de outra entrega; nao edite os mesmos arquivos concorrentemente.

Os perfis nao autorizam implementar todo o backlog, iniciar outros agentes ou publicar. Preserve mudancas do usuario e diferencie especificacao, simulacao e integracao real. O documento `docs/09-financeiro-pagamentos-e-fluxo-de-caixa.md` descreve o financeiro ampliado; o primeiro recorte implementado esta em `docs/11-financeiro-primeiro-recorte.md`. Confirme sempre o estado atual no codigo. Se alterar os perfis nesta workspace, sincronize suas copias no diretorio pai `.codex/agents` quando esse diretorio existir.

## Execucao e evidencias

- Preserve o produto Sistem e a stack Next.js/React/TypeScript/CSS. Backend Node.js, identidade real e banco operacional por empresa continuam planejados; nao substitua o projeto com base em modelos externos.
- Use o protocolo e os modelos de delegacao/entrega de `docs/10-equipe-de-agentes.md`. Defina objetivo, criterios, dependencias e arquivos permitidos antes de delegar; tarefas pequenas dispensam toda a equipe e documentacao formal extensa.
- Testes antes do codigo: defina cenarios, entradas e resultados esperados pelos requisitos; escreva e execute os testes automatizados pertinentes antes de alterar o comportamento. Confirme a falha esperada para funcionalidade ausente/bug, implemente e execute novamente. Nao copie expectativas da implementacao nem enfraqueca testes para obter sucesso; alteracoes legitimas de requisito ou correcao de erro no teste precisam de justificativa registrada. Ajustes documentais/visuais sem automacao util exigem verificacao definida antes da edicao. Declare impedimentos de execucao, sem inventar falha ou aprovacao.
- O coordenador resolve escolhas tecnicas dentro do escopo, acumula arquitetura/integracao e exige revisao independente quando o risco justificar. Nao crie agentes adicionais se os existentes forem suficientes.
- Os papeis de arquiteto, revisor e especialista podem ser atribuidos a agentes existentes quando adequado, preservando independencia em relacao a quem implementou. O perfil orquestrador e referencia para coordenacao; iniciado como subagente, limita-se ao recorte recebido e reporta ao principal.
- Um responsavel por conjunto de arquivos de cada vez; contratos compartilhados antes de implementacoes dependentes. Resolva divergencias com evidencia, impacto e alternativa, sem sobrescrever trabalho.
- Codigo determina o comportamento implementado; requisitos aprovados determinam o esperado. Investigue divergencias, sem transformar bugs em requisitos. Atualize a documentacao existente da tarefa e seu estado.
- Entregas registram status, alteracoes, comandos/resultados, limitacoes, riscos e pendencias. Build aprovado nao substitui verificacao funcional; nao altere testes para ocultar falha nem declare testes que nao executou.
- Publicacao em producao, despesas e operacoes destrutivas com dados/ambientes reais exigem autorizacao explicita do usuario. Reutilize autorizacoes ja registradas quando cobrirem a mesma acao e suas condicoes; um perfil nao concede essa autorizacao.
- Nao exponha credenciais. Nao altere configuracao global, audiencia, permissoes externas ou desative verificacoes para forcar sucesso.

## Criterio de usabilidade operacional

Cada jornada deve reduzir trabalho da loja: reaproveitar dados conhecidos, evitar digitacao/lancamento duplicado, reduzir trocas de tela e mostrar campos de excecao quando necessarios. Analista registra o caminho comum e o esforco; desenvolvedor preserva contexto e automatiza efeitos de dominio; QA verifica os passos reais, erros e recuperacao. Autoria so vem automaticamente de identidade real quando implementada; Pix nao e confirmado por inferencia. Nao declare ganho de tempo ou validacao com atendentes sem medir. As melhorias propostas para o balcao ainda precisam ser implementadas e verificadas; alterar este guia nao as entrega.

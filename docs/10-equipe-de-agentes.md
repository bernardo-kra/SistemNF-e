# Equipe de agentes do Sistem

Criada em 17/10/2026. Os perfis sao configuracoes locais de agentes do Codex para trabalhar neste projeto; nao sao usuarios do ERP nem agentes de IA embarcados no produto.

## Papeis

| Agente | Responsabilidade | Entrega |
| --- | --- | --- |
| `analista` | Investigar o problema, definir regras, estados, limites e criterios verificaveis. | Especificacao do recorte, invariantes e criterios de aceite, com evidencias e premissas. |
| `desenvolvedor` | Implementar o recorte atribuido, preservar dados e tratar estados/erros. | Codigo, migracao quando necessaria e verificacoes pertinentes. |
| `qa` | Revisar a entrega de forma independente e reproduzir riscos relevantes. | Achados com passos/evidencias e parecer limitado ao escopo verificado. |

O agente principal coordena as dependencias, distribui arquivos, resolve conflitos e consolida a entrega. O desenvolvedor nao aprova o proprio trabalho em nome do QA. O QA pode reprovar; o analista pode contestar um requisito. Discordancias precisam de evidencia, impacto e alternativa.

## Configuracao

Os perfis versionados estao em `.codex/agents/analista.toml`, `desenvolvedor.toml` e `qa.toml`, na raiz do repositorio da aplicacao. Cada perfil define nome, descricao e instrucoes. Modelo, esforco e permissoes permanecem herdados da sessao; nao foi alterada a configuracao global do usuario.

Nesta workspace, o repositorio Git e `D:\SistemNF-e\web`, enquanto o diretorio aberto e `D:\SistemNF-e`. Para atender os dois pontos de entrada, ha copias identicas dos perfis em `.codex/agents` da workspace e da aplicacao. O coordenador deve manter essas copias sincronizadas quando alterar os papeis. A copia em `web` e a que pode ser versionada e reutilizada ao clonar o repositorio.

O formato segue a [documentacao oficial OpenAI sobre subagentes](https://learn.chatgpt.com/docs/agent-configuration/subagents). Descoberta dos arquivos depende do cliente e do contexto do projeto. Nao confundir perfil salvo com processo permanente: a sessao/coordenador precisa iniciar as tarefas. Caso o cliente ainda nao descubra um perfil recem-criado, o coordenador pode iniciar o agente passando suas instrucoes explicitamente e verificar a configuracao na proxima sessao.

## Fluxo de trabalho

1. O coordenador identifica a tarefa autorizada, os documentos relevantes e o estado real da aplicacao. Criar a equipe nao autoriza, sozinho, implementar todo o backlog.
2. O analista define o menor recorte coerente e seus criterios. O QA pode revisar riscos/cenarios em paralelo com essa analise.
3. O desenvolvedor implementa depois de receber regras e escopo de arquivos. Se houver ambiguidade essencial, reporta enquanto continua trabalho independente; escolhas rotineiras nao exigem nova aprovacao.
4. O QA revisa a implementacao pronta e executa verificacoes proporcionais ao risco. Comportamento ainda nao testado permanece identificado.
5. O desenvolvedor corrige achados confirmados. O QA verifica as correcoes afetadas. O coordenador consolida o resultado e informa limites reais.

Somente investigacoes ou tarefas com arquivos independentes devem acontecer em paralelo. Nenhum agente edita simultaneamente os mesmos arquivos, altera a expectativa de teste para esconder falha ou inicia integracoes externas sem atribuicao. Git, publicacao e mudancas de infraestrutura ficam coordenados pelo agente principal, dentro da autorizacao do usuario.

## Como pedir

Exemplo para a proxima etapa financeira:

> Use o analista para recortar entrada e parcelas do financeiro; o desenvolvedor para implementar o recorte acordado no prototipo; e o QA para verificar centavos, vencimentos, pagamento parcial, persistencia e preservacao dos dados existentes.

Exemplo de revisao sem alteracao:

> Peca ao analista e ao QA uma revisao critica do fluxo de caixa. O desenvolvedor deve apenas mapear os arquivos e dependencias, sem implementar ainda.

Esses exemplos sao instrucoes para o coordenador, nao comandos de terminal. Tarefas pequenas podem ser resolvidas diretamente; nao e necessario acionar tres agentes para cada edicao.

## Contexto comum e criterios

- A aplicacao e um prototipo Next.js/React/TypeScript/CSS com exportacao estatica. Verificar no README/codigo se isso mudou antes de planejar.
- Fiscal e financeiro simulados nao comprovam integracao bancaria/fiscal, conformidade ou isolamento de empresas.
- Banco operacional por empresa, uma base de codigo e parceiras independentes sao decisoes do produto; nao trocar o modelo silenciosamente.
- No financeiro, `docs/09-financeiro-pagamentos-e-fluxo-de-caixa.md` especifica a direcao ampliada. O primeiro recorte implementado esta em `docs/11-financeiro-primeiro-recorte.md`: `OS.received` permanece legado, separado dos novos titulos, pagamentos, alocacoes e movimentos de conta.
- Testes devem verificar comportamento e invariantes de maior risco. Nenhum agente declara execucao, aprovacao ou cobertura que nao observou.
- O conhecimento duravel fica nos arquivos e relatorios; nao ha promessa de memoria permanente ou retreinamento do modelo.

Cada tarefa deve trazer: objetivo, comportamento atual, criterios, arquivos atribuidos, exclusoes, dependencias, verificacoes e resultado esperado. Cada devolutiva deve registrar: evidencias, alteracoes (se autorizadas), comandos/resultados, riscos e pendencias. Nao usar apenas “pronto” ou “aprovado”.

## Primeira rodada — 17/10/2026

Os tres agentes foram iniciados nesta sessao com as instrucoes de seus perfis passadas explicitamente. Cada um concluiu uma tarefa de diagnostico somente leitura. A criacao da equipe nao modificou funcionalidades da aplicacao.

- **Analista:** recomendou iniciar por acordo de pagamento e parcelas de vendas/OS, com soma exata, vencimentos validos, persistencia e tratamento do legado. Identificou uma dependencia a resolver antes de receber em dinheiro: a especificacao exige turno aberto em F1, mas posiciona turnos em F3. Antecipar o turno minimo ou adiar esse recebimento no primeiro recorte.
- **Desenvolvedor:** mapeou `FinancePage`, `receivePayment`, tipos, persistencia/migracao e resumos da OS/painel. Confirmou que o vencimento hoje mostrado no financeiro vem da previsao da OS, sem uma parcela financeira propria. Preservar os valores antigos sem fabricar conta, data ou movimento de caixa e revisar os consumidores de `.received` na implementacao.
- **QA:** conferiu os campos e delimitadores dos perfis, igualdade das copias e separacao das responsabilidades. Nao encontrou defeito estrutural. Prioridades futuras: migracao sem caixa ficticio, diferenca entre pagamento e liquidacao e testes de parcelas/centavos/datas/duplicidade. Esses riscos nao foram apresentados como funcionalidades testadas ou homologadas.

**Verificacao realizada:** tres pares de perfis identicos, campos obrigatorios preenchidos, documentacao e links locais conferidos. O QA nao encontrou parser TOML completo instalado; a validacao foi estrutural. Descoberta automatica dos arquivos pelo cliente nao foi testada. Nao foram executadas suites/build do produto nesta rodada, pois nao houve mudanca de codigo funcional.

## Rodada de implementacao financeira — 17/10/2026

A pedido do usuario, os tres agentes discutiram e executaram o [primeiro recorte financeiro](11-financeiro-primeiro-recorte.md). O analista definiu regras e criterios; o desenvolvedor implementou dominio, migracao e persistencia; o QA escreveu e executou verificacoes independentes. O coordenador integrou as telas e os consumidores de saldo, fez revisao e verificou o artefato de producao.

As decisoes conjuntas anteciparam um turno minimo para aceitar dinheiro, mantiveram valores legados sem caixa ficticio e limitaram Pix/transferencia a credito conferido manualmente. A revisao corrigiu a cronologia entre gravacao e restauracao, a atualizacao da data financeira na virada do dia e a visibilidade da acao Receber no celular. Resultados e pendencias estao registrados no relatorio, sem tratar a simulacao como integracao real.

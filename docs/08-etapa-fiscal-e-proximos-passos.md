# Etapa fiscal e próximos passos

Atualizado em 16/10/2026. Escopo: loja de eletrônicos e manutenção de TI. Município/UF e regime do primeiro cliente real continuam desconhecidos.

## Decisão e entrega desta etapa

[Certeza] O protótipo continua sendo um front estático, sem autenticação, banco ou emissor fiscal. O módulo implementa uma simulação local para validar a experiência antes da integração.

| Prioridade | Trabalho executado                                                                                       | Critério de conferência                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1          | Dados do emitente, endereço e regime declarado em `/fiscal/configuracao/`.                               | Salvar parcialmente; apontar pendências; não solicitar segredos.            |
| 2          | Revisão declarada de produtos e serviço em `/fiscal/revisao/`; documento/endereço opcionais no cliente.  | Validar estrutura e dígitos, sem afirmar enquadramento correto.             |
| 3          | Preparação a partir de venda ou OS com cópia dos dados.                                                  | Exigir consistência da origem; mostrar pendências com caminhos de correção. |
| 4          | Fila, processamento, rejeição, nova tentativa, resposta desconhecida, consulta e cancelamento simulados. | Bloquear transições inválidas e duplicidade local; manter histórico.        |
| 5          | Migração v1 → v2 sem apagar operações válidas anteriores.                                                | Testar preservação de clientes, estoque, vendas e OS.                       |
| 6          | Testes de domínio e navegador, revisão responsiva e build estático.                                      | Cobrir falhas relevantes, além da jornada de sucesso.                       |

A simulação não gera número oficial, chave, protocolo, XML fiscal ou DANFE. `SIM-...` identifica somente registros locais. O seletor de resultado existe para exercitar a interface.

## Regras adotadas para a demonstração

- Venda prepara NF-e ou NFC-e simulada. Uma mesma origem não pode ter dois documentos simulados ativos, mesmo trocando o modelo. É uma simplificação deliberada: faturamento parcial, complementar e outras operações exigirão outro modelo de domínio.
- OS aprovada prepara NFS-e apenas sobre `labor`. `parts` fica destacado como excluído e pendente de uma operação própria de mercadorias. Ainda não existe vínculo entre peças da OS e itens de estoque. Não tratar a OS como totalmente faturada.
- Aprovação da OS, identificação do destinatário e campos exigidos na conferência são requisitos internos da demonstração. Não são uma lista universal de exigências legais, sobretudo para NFC-e/NFS-e.
- NCM, origem, CFOP, CST/CSOSN e códigos de serviço são declarados pelo usuário. A aplicação verifica presença/formato, sem validar existência, compatibilidade ou vigência. CEST e classificação IBS/CBS opcionais não são dispensas fiscais. Não se copia automaticamente a tributação da compra para a venda.
- CPF/CNPJ têm verificação estrutural e de dígitos, incluindo CNPJ alfanumérico. Não há consulta à Receita Federal ou validação de inscrição estadual, CEP, código IBGE ou situação cadastral.
- A preparação guarda uma cópia independente dos cadastros. Uma nova tentativa após rejeição mantém o documento, revisa os dados atuais e registra outra cópia. Alterar o cadastro não reescreve as anteriores.
- Resultado desconhecido impede reenvio. A consulta simulada permite reconciliar após recarregar a página, inclusive se o processamento ficou interrompido.
- Cancelamento requer solicitação e confirmação separadas. Os 15–255 caracteres são uma restrição da demonstração, sem afirmar cobertura de prazos/regras do autorizador.
- Nenhuma transição fiscal altera recebimentos, reserva ou saldo do estoque. Não existe estorno automático da operação comercial.
- Armazenamento e bloqueio de duplicidade são locais ao navegador. Não protegem contra concorrência, duas abas ou computadores. Histórico local é editável pelo usuário e não equivale a trilha auditável de servidor.

## Sequência de desenvolvimento após o protótipo

1. **Definir o piloto fiscal.** Identificar estabelecimento, município/UF, regime, inscrições, atividades, tipos de operação e documentos necessários. Revisar com o responsável fiscal a separação de mercadorias/serviços e os enquadramentos. Resultado: matriz de cobertura e exemplos aprovados, sem taxas presumidas.
2. **Criar o backend operacional.** Node.js/TypeScript e PostgreSQL são a proposta a validar. Implementar identidade, vínculos/permissões, sessões e resolução de empresa no servidor. Manter um banco operacional por empresa conforme a intenção do projeto, com provisionamento, migrações e backup automatizados; identidade/assinaturas podem ter uma base de controle separada. Testar acesso cruzado, revogação, concorrência e restauração antes de usar dados reais.
3. **Persistir operações com transações.** Implementar cadastro, OS versionada/aprovação, catálogo de serviços, itens de peças, séries, reservas e movimentos. Separar faturado, recebido e entregue. Importação XML precisa validar documento, destinatário e duplicidade antes de efetivar entrada/contas a pagar.
4. **Integrar um adaptador fiscal no servidor.** Comparar provedores por cobertura efetiva do piloto, ambientes, consulta, cancelamento, armazenamento, custo e portabilidade. Nenhum fornecedor foi contratado. Credenciais e certificados ficam fora do browser. Persistir intenção, chave de idempotência, cópia da operação e tarefa de envio de forma transacional; processar por worker.
5. **Homologar por modelo e operação.** Validar schemas/notas técnicas vigentes, cálculos e arredondamentos, respostas, consulta de resultado desconhecido, retornos repetidos/fora de ordem, falhas após envio, eventos e prazos. Fazer testes de contrato do adaptador e revisão fiscal. Não converter a conferência simplificada do front em motor tributário de produção.
6. **Liberar o piloto com critérios de saída.** Conferir permissões, observabilidade, exportação de documentos, retenção definida, restauração, suporte e contingência aplicável. Depois medir uso e custo para estruturar planos/limites e cobrança mensal idempotente. Bloqueio de assinatura não deve apagar documentos.

[Provável] Um provedor fiscal tende a reduzir a carga inicial de integração de uma equipe pequena. Isso depende da cobertura, contratos e custo medido; não elimina as responsabilidades de cadastro, reconciliação e operação.

## Contratos propostos para o backend

São propostas para revisão, não endpoints implementados. O servidor determina a empresa pela sessão/vínculo e valida permissões; não confia em um banco ou identificador de empresa enviado livremente pelo cliente.

| Operação            | Proposta                                         | Regra essencial                                                                                                                         |
| ------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Configuração        | `GET/PATCH /v1/fiscal/profile`                   | Versão concorrente; não devolver segredos.                                                                                              |
| Conferência         | `POST /v1/fiscal/preflight`                      | Origem, modelo e versão; devolver pendências estruturadas. Revalidar ao preparar.                                                       |
| Preparação          | `POST /v1/fiscal/documents`                      | `Idempotency-Key`, origem/versão/modelo; mesma chave + conteúdo diferente gera conflito. Cópia e identidade do solicitante preservadas. |
| Envio               | `POST /v1/fiscal/documents/{id}/submissions`     | Aceite assíncrono `202` com identificador consultável; tarefa transacional e controle de concorrência.                                  |
| Consulta            | `GET /v1/fiscal/documents/{id}`                  | Estado, versão e eventos; nunca presumir autorização por tempo decorrido.                                                               |
| Reconciliação       | `POST /v1/fiscal/documents/{id}/reconciliations` | Consultar provedor/autorizador antes de reenviar uma resposta ambígua.                                                                  |
| Cancelamento        | `POST /v1/fiscal/documents/{id}/cancellations`   | Permissão, justificativa, regras atuais e retorno externo; solicitação não equivale a confirmação.                                      |
| Retorno do provedor | Endpoint separado e autenticado do adaptador     | Validar autenticidade e vínculo; deduplicar eventos e tratar ordem/versão.                                                              |

Erros devem incluir código estável, descrição acionável e correlação. `409` representa conflito/duplicidade conforme contrato; falhas de preenchimento têm campos/códigos específicos. IDs oficiais só aparecem após validação do retorno externo. As fronteiras de valor e quantidade precisam de decimal exato e política de arredondamento definida; centavos inteiros e quantidades inteiras desta demonstração são insuficientes para todo cenário fiscal.

## Como validar agora

Executar `npm.cmd run typecheck`, `npm.cmd test` e `npm.cmd run build` na pasta `web`.

Os testes `fiscal-engine.spec.ts` cobrem dígitos, migração, conferência, cópias de dados, duplicidade entre modelos, recuperação, nova tentativa e independência de estoque/financeiro. `fiscal-browser.spec.ts` exercita os formulários e o fluxo por navegador, persistência, atalhos e largura de 390px. Os testes anteriores continuam cobrindo OS, vendas, estoque e XML. Não houve homologação fiscal ou teste de isolamento real entre empresas.

Para explorar o fluxo, configure dados **fictícios** em Documentos fiscais → Configuração fiscal e Revisar cadastros, complete documento/endereço do cliente e prepare uma venda ou OS aprovada. Os códigos de teste em `tests/fiscal-fixtures.ts` servem apenas aos testes estruturais; não são recomendação de enquadramento. Também é possível verificar os bloqueios com os cadastros incompletos iniciais.

## Referências e limites

- [Receita Federal — manual do cálculo dos dígitos do CNPJ](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj/manual-dv-cnpj.pdf): base para conferência de CNPJ numérico e alfanumérico. Não comprova existência do cadastro.
- [NFS-e — documentação técnica atual](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual): ponto de consulta para futura integração; não foi implementado ou homologado um leiaute de produção.
- [Lei Complementar 116/2003, lista de serviços](https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp116.htm): referência para discutir atividades e exceções com o responsável fiscal. A existência de serviço e peças em uma OS não permite presumir uma única tributação.

Não foram fixadas alíquotas, dispensa de campos, códigos tributários do piloto, revisão de schema ou cronograma obrigatório sem identificação da operação e validação atualizada.

## Verificação da exportação Windows

A inspeção do build estático encontrou arquivos de segmentos em diretórios aninhados, enquanto o navegador solicitava nomes separados por pontos. O comportamento foi reproduzido no projeto e corresponde ao [registro no repositório oficial do Next.js](https://github.com/vercel/next.js/issues/92339). `postbuild` adiciona os nomes esperados sem alterar o conteúdo ou os arquivos originais. Três testes verificam normalização, idempotência e proteção contra colisões; a navegação do artefato estático também é conferida no Chrome. O código em `node_modules` permanece intacto.

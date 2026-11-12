# Sistem API

## Versões do orçamento e autorização informada — 12/11/2026

Nova OS guarda `budgetScope` reaproveitado da solicitação, `budgetRevision:1` e `budgetHistory`. Mudança efetiva de escopo/valor antes do aceite gera versão com autor/hora do servidor; notas técnicas/previsão/atribuição não alteram orçamento. Null continua pendente e zero é serviço gratuito. Limite100 preserva histórico, bloqueando só nova versão, não seu aceite.

O comando `order.approve` no endpoint operacional exige `orders.update`, `{id,version,budgetRevision,channel,reference?}`. Canal obrigatório `in_person|whatsapp|phone|email`, referência opcional até500 caracteres. Servidor confere etapa/valor/revisões e copia cliente/escopo/valor para `budgetApproval`; não recebe autoria/data do cliente. Não é assinatura digital do consumidor ou confirmação automática do canal. `order.update` aceita `budgetScope`, mas não muda aprovação por booleano; chamar `order.approve` para novos aceites. Permissões são conferidas também antes do replay. Uma revisão posterior ao aceite/acordo não está habilitada.

Legado aprovado permanece sem evidência fabricada. Legado pendente recebe apenas fotografia observada no primeiro aceite ou mudança material; eco de escopo sem mudança não o migra parcialmente. Corpo/comprovante autorizado podem exibir orçamento/aceite; auditoria registra revisão/canal sem duplicar referência textual. Histórico está no corpo da OS, limitado a100 versões, usando armazenamento/transação existentes; nenhuma migração ou dependência nova. Relatórios continuam retratando os valores atuais, não uma reconstrução histórica. Sem alteração de fiscal, dinheiro, estoque ou peças. [Critérios e validação OS-OV](../docs/16-regras-de-negocio.md#os-ov--versões-do-orçamento-e-registro-do-aceite--12112026).

## Cadeia do assinante com âncora explícita — 10/11/2026

`verifyNfseCandidateSignature(raw, trustPolicy?)` aceita um segundo argumento exclusivo do futuro coordenador do servidor: `{rootCertificatePem, intermediateCertificatesPem}`. A lista contém até quatro intermediárias em ordem folha→raiz e exclui folha/raiz. Nunca preencher esse contexto a partir de formulário, payload ou KeyInfo. Nenhuma raiz real foi instalada nem existe configuração de usuário final para esse contrato interno.

Sem contexto, preserva conferência matemática e `trustChainVerified:false`; contexto presente inválido gera `NFSE_CERTIFICATE_CHAIN_INVALID`, sem downgrade. `nfse-signer-chain.ts` valida caminho linear, assinaturas, raiz autoassinada, datas explícitas, RSA2048–8192/SHA256–512, usos de folha/CA, pathLen e limites. Recusa certificados/extensões duplicados, restrições não suportadas e extensões críticas desconhecidas. Não consulta rede, repositório do sistema ou revogação, nem descobre caminhos alternativos.

Sucesso acrescenta fingerprint da raiz, tamanho da cadeia e `trustChainVerified:true` somente para a âncora configurada. Não confirma identidade SEFIN, política integral ICP-Brasil, revogação, perfil/contrato, autorização ou prontidão. Essas flags permanecem false. Sem integração a rota, custódia, diário ou transporte.93/93 testes backend e repetição dos mesmos40 cenários contra `dist`, tipos/build/seis checks aprovados. [Contrato, TDD e limites NFSD-CA](../docs/08-etapa-fiscal-e-proximos-passos.md#nfsd-ca--cadeia-do-assinante-configurada-no-servidor--10112026).

## Conferência criptográfica de candidata NFS-e — 10/11/2026

`verifyNfseCandidateSignature` recebe os mesmos campos da inspeção mais `expectedSignerCertificatePem` (um certificado público esperado, fornecido separadamente) e `at` (Date explícita do coordenador). Não aceitar esses campos diretamente de um formulário de emissão nem copiar o certificado do KeyInfo para preencher a expectativa. O certificado do assinante da resposta não é o A1 da loja por inferência.

Confere estrutura/correlação, DER do assinante, RSA2048–8192, não CA e período finito de validade. Depois verifica SHA256 de infNFSe inteiro, incluindo assinatura interna, e RSA-SHA256 sobre SignedInfo/C14N1.0, com transformações/referência fechadas. Metadados retornam `candidate_signature_verified`, `signatureVerified:true`, `certificateMatched:true` e fingerprint somente quando os dois conferem. Sem o contexto explícito de cadeia descrito acima, `trustChainVerified` continua false. Perfil oficial, revogação, contrato, autorização e prontidão permanecem false também com cadeia válida. Não é verificação institucional completa nem compatibilidade comprovada com SEFIN.

`nfse-xml-signature.ts` compartilha a leitura restrita de XMLDSig com DPS; códigos e regras específicas do DPS são preservados. Datas de certificado não finitas agora são recusadas nos dois verificadores. Inspeção simples continua entrada separada, sem confirmar assinatura. Sem I/O fiscal, banco, PFX, custódia, rota, tela ou mudança de estado. [Critérios, testes e limites NFSD-SV](../docs/08-etapa-fiscal-e-proximos-passos.md#nfsd-sv--verificação-criptográfica-da-resposta--10112026).

## Inspeção estrutural de resposta NFS-e — 10/11/2026

`inspectNfseCandidate` em `nfse-response-validation.ts` recebe `{expectedDpsXml,nfseXmlGZipB64,expectedAccessKey?}` de futuro coordenador interno. Fonte esperada deve vir da assinatura já persistida. Base64 limitado a512KiB, gzip com saída limitada a512KiB, UTF-8/XML seguros, XSD oficial1.01 fixado e correspondência da DPS completa por canonicalização exclusiva sem comentários. Emitente e chave opcional também são conferidos; IDs duplicados/aliases, assinatura estrutural ausente, Object e referências externas falham. Não há inferência de autorização por HTTP/cStat.

Retorno contém somente hashes/metadados e `candidate_correlated`. `signatureVerified`, `trustChainVerified`, `contractConfirmed`, `officialAuthorization` e `readyForSubmission` permanecem false. Assinatura no XSD é estrutural: não verifica criptografia, cadeia, revogação, cálculo tributário ou situação fiscal. Não retorna XML/tomador/certificado. Sem rede, banco, custódia, simulação, rota ou novo botão; não muda o diário para nota autorizada.

Loader/hash/resolver agora são compartilhados em `nfse-xml-schema.ts`, com os cinco XSD originais do pacote público de20/10/2026. Guards/códigos de erro DPS continuam preservados. Não criar whitelist concorrente no resolver global. [Contrato e evidências NFSD-RX](../docs/08-etapa-fiscal-e-proximos-passos.md#nfsd-rx--inspeção-de-xml-recebido--10112026).

Após build, `SISTEM_QA_COMPILED_RESPONSE=true` somente no processo de teste repete os15 cenários de `test/nfse-response-validation.test.ts` contra `dist`; não é flag de emissão ou configuração de produção. Rodada backend com regressões68/68 e repetição compilada15/15 aprovadas. Não comprova aceite autenticado do órgão.

## Diário interno de tentativa fiscal — 09/11/2026

`nfse-dps-submission-journal.ts` prepara o controle durável de futura transmissão restrita, sem chamar rede/custódia e sem rota pública. `startDpsSubmission` recebe somente `{requestId,signatureId}` de assinatura já persistida: primeira reserva tem `claimed:true`; replay/equivalência têm false. Isso não concede autorização para envio (`readyForSubmission:false`, `officialAuthorization:false`). Existe uma única tentativa por DPS/assinatura, sem rearmar após falha.

`recordDpsSubmissionOutcome` recebe `{requestId,attemptId,version,phase,outcome}`. Envio (`phase:submission`) parte de `dispatch_reserved` para `result_unknown` ou `response_unverified`; esta última exige `httpStatus` e `responseSha256`, sem corpo/XML. Consulta (`phase:lookup`) só pode levar desconhecido para resposta não verificada; sua falha preserva desconhecido. Nenhum código HTTP prova aceite fiscal. `recoverExpiredDpsSubmission({requestId,attemptId,version})` recupera reserva após dois minutos pelo relógio do banco, sem novo envio/número. Prazo habilita recuperação explícita; recibo recebido antes dela ainda pode ser guardado como não verificado, mesmo após o prazo. Depois dela, versão antiga conflita. `getDpsSubmission` lê metadados/eventos sem mutação ou material privado.

O futuro coordenador deve validar autorização atual e todos os bloqueios fiscais antes de usar o serviço. Migração incremental `tenant_012` mantém tentativa/pedidos/eventos separados do simulador e dos documentos autorizados; eventos/pedidos são imutáveis. Rodar esta migração não habilita emissão. [Escopo/testes/limites NFSD-JT](../docs/08-etapa-fiscal-e-proximos-passos.md#nfsd-jt--diário-de-tentativa-e-recuperação--09112026). Nenhuma migração remota foi aplicada nesta etapa.

## Simulador fiscal conectado — 09/11/2026

`FISCAL_SIMULATOR_ENABLED=true` habilita somente o simulador local. Ausente/false mantém comandos desativados; outros valores falham na configuração. Exige `fiscal.simulate` com leitura fiscal/OS; gestores podem conceder o direito explicitamente aos funcionários. Nenhum CNPJ/A1 ou serviço externo é necessário, e a flag não habilita emissão oficial.

Sob `/api/v1/tenants/:tenantId/fiscal/simulations`: GET `/config`, GET `?orderId=UUID&limit=25&offset=0`, GET `/:id`, POST com `{requestId,orderId,orderVersion,scenario}` e POST `/:id/reconcile` com `{requestId,version}`. Cenários: `accepted`, `rejected`, `unknown_after_accept`. OS precisa ter serviço aprovado/valor positivo; valor/cliente vêm do banco. Retorno sempre indica `environment:simulation`, `provider:local_simulator`, `officialAuthorization:false` e referência `SIM-`. Snapshot não muda com a OS; pedidos equivalentes recuperam o registro, sem nova nota ou efeitos operacionais. Histórico de eventos/auditoria e chaves por ator/comando/conteúdo são transacionais.

Migração incremental `tenant_011` adiciona três tabelas próprias de simulação, sem converter DPS, estoque ou financeiro. Aplicada nesta etapa somente aos bancos genéricos de teste. Não execute migrações remotas por inferência deste guia. Após build, `node --import tsx test/fiscal-simulation-browser-smoke.ts --run`, em server, usa Chrome, Better Auth e PostgreSQL genérico isolado na porta4000. [Contrato e evidências SIM-NFSE](../docs/08-etapa-fiscal-e-proximos-passos.md#sim-nfse--fluxo-de-testes-conectado--09112026).

## Transporte fiscal e prontidão — 09/11/2026

GET `/api/v1/tenants/:tenantId/fiscal/readiness` exige `fiscal.read` e vínculo da empresa, sem parâmetros extras ou mutação. Retorna ambiente restrito, `readyForSubmission:false`, configuração apta ao recorte de preparação (`setup.profileComplete`), presença/validade local por emitente do A1 e armazenamento configurado, sem material privado. É orientação de cadastro, não validação ICP-Brasil ou autorização fiscal. O painel consulta ao abrir/retentar e mantém envio indisponível.

`NfseNationalTestClient` é protótipo interno: host fixo de homologação, GET de DPS/nota e POST de XML estruturalmente assinado comprimido em gzip/base64. Envelope candidato ainda não confirmado no Swagger. Retorno tem `contractConfirmed:false` e `authorizationConfirmed:false`; HTTP400/422 não é classificado automaticamente como rejeição fiscal, falha de POST é inconclusiva, sem retry. Fachada `NfseNationalReadClient` continua só leitura; `instanceof`/códigos foram preservados por alias, mas o nome interno do erro passou a `NfseNationalTransportError`. Nenhuma rota/custódia chama o protótipo de envio. Journal/reconciliação e validações oficiais precisam preceder essa conexão. Sem publicação, transmissão autenticada ou migração. [Critérios e evidências](../docs/08-etapa-fiscal-e-proximos-passos.md#nfsd-tr--transporte-e-pendências-de-emissão--09112026).

Depois do build e com porta4000 livre, `node --import tsx test/nfse-readiness-browser-smoke.ts --run` verifica o painel compilado com Better Auth e PostgreSQL genérico isolado; não emite nota nem acessa banco remoto.

## Entrada mínima da OS — 09/11/2026

`order.create` exige cliente ativo, equipamento e solicitação; `technicianId`/`due` omitidos ou null ficam explicitamente null, assim como `technicianName` sem atribuição. `order.update` omitido preserva; null limpa previsão em qualquer etapa editável e técnico somente em `received`. Previsão é opcional, nunca vencimento financeiro. Valores antigos não são migrados.

`order.advance` exige técnico e aceita `technicianId` válido somente em `received`, para atribuir/iniciar diagnóstico em um comando/versão/auditoria. Nesse caso exige `orders.update` e `orders.advance`, inclusive replay; falha reverte o conjunto. A UI usa o editor existente com uma seleção/uma confirmação. Relatório admite nome null só com ID null em `received|closed_without_repair`, mostra pendência e exporta nome vazio. Comprovante mostra **Técnico a definir**/**Sem previsão**, sem nome do usuário ou data automática. Smoke compilado existente também verifica recebimento mínimo e início conjunto com login/banco genérico. [Contrato OS-EN](../docs/16-regras-de-negocio.md#os-en--entrada-sem-técnico-ou-previsão--09112026). Sem migração, dependência ou publicação.

## Orçamento pendente da OS — 09/11/2026

`order.create` aceita `laborCents:null` ou propriedade omitida para valor ainda não definido; zero continua gratuito. `order.update` omitido preserva e null explícito limpa somente proposta não aprovada. Aprovação/início exigem valor definido; acordo exige valor positivo. Permissões, versão, tentativa e auditoria continuam no comando existente. Sem migração de valores antigos. Recibo mantém null; relatório/CSV somam definidos e informam `totals.unpricedCount` de toda a seleção, com null preservado nos itens. Campo monetário ausente/malformado no banco e null aprovado continuam inconsistências, sem falso zero. [Contrato e evidências OS-OP](../docs/16-regras-de-negocio.md#os-op--orçamento-pendente-e-serviço-gratuito--09112026).

O smoke compilado de devolução abaixo também ensaia pendente→zero→aprovação/início sem acordo, recebimento ou estoque. Usa apenas fixture genérica isolada e exige `--run`; não acessa ambiente remoto.

## Devolução de OS sem reparo — 08/11/2026

POST `/api/v1/tenants/:tenantId/operations/commands`, `type: "order.return_without_repair"`, com direito `orders.deliver` e formato `{requestId,type,data:{id,version,reason,details?,recipient,confirmed:true}}`. `reason`: `estimate_declined|repair_unavailable|customer_withdrew|other`; detalhe obrigatório para `other` (até500 caracteres). `recipient:{type:"customer"}` reutiliza o nome da OS no servidor; `{type:"other",name,authorization}` exige nome (até120) e autorização (até500), sem CPF/senha. Autor e instante nunca vêm do payload.

Elegível somente em `received|diagnosing|awaiting_approval`, `approved=false`, `tested=false` e sem acordo. Após conferência e confirmação, estado terminal `closed_without_repair`, com `returnWithoutRepair {reason,details,recipientType,recipientName,authorization,at,actorId,actorName}`. Não edita o orçamento, não aprova/testa nem modifica financeiro, estoque ou fiscal. Não cancela serviço aprovado/iniciado, não modela diagnóstico pago ou reembolso. Esses casos continuam pendentes.

Mesma tentativa/conteúdo recupera o resultado com direitos atuais; mudança conflita. Versão/concorrência e auditoria usam a transação operacional existente. Depois de encerrada não aceita editar/avançar/entregar reparo ou nova devolução. Auditoria guarda etapa/motivo/tipo de retirante, sem duplicar os textos de autorização; a OS autorizada preserva o registro completo. Listagem/relatório aceitam a etapa; comprovante inclui motivo/retirante e identifica preço como proposta não executada. Sem migração/dependência nova.

`node --import tsx test/order-return-browser-smoke.ts --run`, após build com porta4000 livre, ensaia Chrome→aplicação compilada→PostgreSQL genérico isolado, sem dados reais. [Critérios/evidências OS-SR](../docs/16-regras-de-negocio.md#os-sr--devolução-sem-reparo-recorte-de-implementação).

## Relatório de ordens de serviço conectado — 08/11/2026

Opção **Ordens de serviço** em `/relatorios/`. GET `/api/v1/tenants/:tenantId/reports/orders?from=AAAA-MM-DD&to=AAAA-MM-DD&q=...&stage=all&approval=all&limit=25&offset=0` exige sessão, `finance.read`, `orders.read` e vínculo físico do banco. Datas selecionam a criação inclusiva em São Paulo. Busca literal pelo cliente registrado na OS; `stage=all|received|diagnosing|awaiting_approval|in_progress|quality_check|ready_for_pickup|delivered` e `approval=all|approved|pending`. `pending` inclui qualquer OS sem aprovação, não apenas a etapa aguardando aprovação.

Uma linha por OS, com técnico/equipamento/etapa/aprovação e mão de obra **atuais registrados na ordem**, sem consultar cadastros atuais ou juntar parcelas/pagamentos. Totais integrais `{count,laborCents,approvedCents,unapprovedCents}`; valores não representam recebido, dívida, peças, caixa ou nota. Entrada antiga não torna o relatório um histórico de orçamento/etapas. Projeção explícita não retorna defeito, diagnóstico, senha ou contato. Inconsistência em toda a seleção (inclusive fora da página) ou soma insegura retorna503, sem fabricar zero.

GET `/api/v1/tenants/:tenantId/reports/orders/export` aceita os mesmos filtros sem `limit/offset`, com seleção integral até 10 mil OS e413 em excesso. Transação consistente somente leitura, CSV seguro e controlador existente, sem migração/dependência nova. Ensaio explícito de relatórios compilados ampliado para os quatro tipos em PostgreSQL genérico isolado. [Critérios, evidências e limites](../docs/12-logs-e-relatorios.md#rel-os--ordens-de-serviço-conectadas--08112026).

## Relatório de vendas conectado — 07/11/2026

Opção **Vendas** na mesma página `/relatorios/`, sem migração ou dependência nova. GET `/api/v1/tenants/:tenantId/reports/sales?from=AAAA-MM-DD&to=AAAA-MM-DD&q=...&status=all&limit=25&offset=0` exige sessão, `finance.read`, `sales.read` e vínculo físico do banco. Período inclusivo pela criação em São Paulo; busca literal pelo nome preservado na venda; `status=all|confirmed|delivered` corresponde à situação atual, sem reconstruir o estado histórico de entrega. Não junta pagamentos/parcelas/produtos: uma linha por venda, usando os valores comerciais preservados, sem preços ou nomes atuais.

Resposta `tenantId`, filtros aplicados, `generatedAt`, página e `totals {count,grossCents,discountCents,totalCents}` da seleção inteira. Inconsistência/decomposição parcial, negativo ou overflow retorna503. O contrato anterior aos descontos, com ambos os campos de decomposição ausentes, é lido como bruto=total e desconto=0; não modifica registros. GET `/api/v1/tenants/:tenantId/reports/sales/export` aceita os mesmos filtros sem paginação e lê toda a seleção até 10 mil vendas; excesso retorna413. Transação consistente somente leitura, CSV seguro no navegador e situação atual identificada. Não representa recebido, caixa, lucro ou nota fiscal. O ensaio explícito de relatórios compilados também cobre vários produtos, descontos e pagamento parcial. [Critérios, evidências e limites](../docs/12-logs-e-relatorios.md#rel-ven--vendas-conectadas--07112026).

## Relatório de parcelas na data-base — 06/11/2026

Disponível localmente em `/relatorios/`, opção **Parcelas**, sem nova migração ou dependência. GET `/api/v1/tenants/:tenantId/reports/installments?from=AAAA-MM-DD&to=AAAA-MM-DD&asOf=AAAA-MM-DD&q=...&status=all&limit=25&offset=0` exige `finance.read` e vínculo físico do banco. `from/to` selecionam vencimentos inclusivos; `asOf` limita criação do acordo/parcela e pagamentos ao fim do dia civil de São Paulo. Busca literal pelo nome histórico no acordo; `status` aceita `all|open|overdue|paid`. `open` inclui todos os saldos positivos (também vencidos), consistente com a consulta financeira existente. Vencida exige vencimento anterior à base; vencimento no próprio dia permanece em aberto. O saldo de hoje não substitui a reconstrução pela data-base.

Resposta: `tenantId`, filtros aplicados, `generatedAt`, `limit/offset`, `items` e totais integrais `{count,principalCents,paidCents,balanceCents,overdueCents}`. Linha preserva origem/acordo/entrada ou parcela, nome histórico, vencimento e valores em centavos seguros. Pagamentos são agregados por parcela antes de juntar às origens, evitando multiplicação. Inconsistência de saldo negativo/overpayment ou soma insegura falha com 503; não cria crédito nem apresenta zero. Uma transação `REPEATABLE READ READ ONLY` mantém totais e linhas coerentes; auxiliares de validação/paginação/transação são compartilhados somente entre os dois relatórios.

GET `/api/v1/tenants/:tenantId/reports/installments/export` usa os mesmos filtros sem `limit/offset`, retorna a seleção integral em JSON para CSV, com limite de 10 mil parcelas e 413 em excesso. CSV registra a data-base/filtros/totais e neutraliza fórmulas. Exportação faz uma nova leitura com a mesma data-base; sem estornos/correções retroativas modelados, o relatório cobre somente acordos e pagamentos já registrados no banco. Não representa caixa, garantia de cobrança, conciliação bancária ou OS sem acordo.

O ensaio explícito `node --import tsx test/receipt-report-browser-smoke.ts --run` foi ampliado para os dois relatórios, usando aplicação compilada/estática e bancos genéricos isolados; porta 4000 livre e build prévio. [Critérios, evidências e limites](../docs/12-logs-e-relatorios.md#rel-par--parcelas-na-data-base--06112026).

## Relatório de recebimentos conectado — 06/11/2026

Disponível localmente, sem nova migração/dependência, publicação ou alteração de registros reais. `/relatorios/` usa o direito existente `finance.read`. GET `/api/v1/tenants/:tenantId/reports/receipts?from=AAAA-MM-DD&to=AAAA-MM-DD&q=...&method=pix&limit=25&offset=0` aceita período inclusivo (dia civil São Paulo), busca literal pelo nome histórico do cliente e meio opcional `cash|pix|transfer`. Devolve `tenantId`, filtros aplicados, instante de geração, paginação, `items` e `totals {count,amountCents}` de toda a seleção; até 100 linhas por página. Consulta revalida sessão/concessão e vínculo físico do banco. Nomes/valores vêm do pagamento/recibo imutável, sem carregar o recibo completo ou multiplicar pelo rateio das parcelas. Transação `REPEATABLE READ READ ONLY` mantém linhas e totais coerentes; erros/overflow não viram saldo zero.

GET `/api/v1/tenants/:tenantId/reports/receipts/export` aceita os mesmos filtros sem paginação e devolve a seleção completa em JSON para gerar o CSV no navegador. Até 10 mil pagamentos; excesso retorna 413 `REPORT_TOO_LARGE`, sem truncamento. É uma nova fotografia consistente ao exportar, podendo incluir pagamentos registrados depois da consulta anterior; data de geração/filtros/totais constam no arquivo. O utilitário de CSV é compartilhado com a demonstração e neutraliza fórmulas. Sem reconciliação bancária, reconstrução de OS antigas, cartão/estorno ou paridade dos outros três relatórios. Testes e evidências no [registro REL-REC](../docs/12-logs-e-relatorios.md#rel-rec--recebimentos-conectados--06112026).

Após o build, `node --import tsx test/receipt-report-browser-smoke.ts --run` executa explicitamente Chrome → aplicação compilada/estática → API/Better Auth → PostgreSQL genérico isolado, com a porta 4000 livre. Não acessa o banco da loja; o ensaio encerra navegador, API e cluster que criou.

## Cadastro restrito de empresas e equipe

O cadastro de empresas fica em `/administracao/`, exclusivo do administrador central do Sistem. Gestor de loja não recebe esse privilégio por ser `owner`; ele usa **Equipe e acessos** para cadastrar os funcionários da própria empresa. Visitantes não têm inscrição pública ou aprovação automática. Consumidores em Clientes não ganham login.

A concessão central usa uma conta já existente e é feita por ferramenta local explícita, após aplicar as migrações: `control_003` e `tenant_004`. A conexão administrativa de migração deve estar em `server/.env.admin.local`, variável `SISTEM_MIGRATION_DATABASE_URL`, junto à configuração privada de runtime já preparada. Nunca envie URL/senha pelo chat ou argumento do processo. A ferramenta recusa outra conta administrativa e registra concessão/revogação, sem trocar a senha ou criar identidade.

```powershell
npm.cmd --prefix server run admin -- --grant-admin ID_EXPLICITO_DA_CONTA
npm.cmd --prefix server run admin -- --revoke-admin ID_EXPLICITO_DA_CONTA
npm.cmd --prefix server run admin -- --prepare-slot CHAVE_CONFIGURADA_DO_BANCO_VAZIO
```

Uma vaga é um banco operacional separado, previamente criado, migrado, vazio e configurado no mapa privado `TENANT_DATABASE_URLS`. `--prepare-slot` marca a identidade física da vaga; recusa banco associado/ocupado e aliases de bancos já registrados. Não cria banco ou recurso pago. A API nunca recebe URL/chave de banco nem credencial de migração. Sem vaga preparada, a tela informa indisponibilidade e não inicia uma empresa. `tenant_admission` vincula a vaga uma vez; não pode ser esvaziado/reaproveitado por timeout. O runtime não promove administradores e só pode preencher as colunas de vínculo do marker.

Ao reaplicar `setup:neon`, o mapa de conexões operacionais adicionais já configuradas é preservado. Configuração anterior inválida ou com outro banco principal é recusada sem substituir o arquivo. Uma vaga foi preparada na publicação de 28/10; cada empresa adicional exige sua própria vaga preparada. Conexões e credenciais de infraestrutura ficam somente no ambiente privado.

Cadastro comum: empresa, nome/e-mail/senha inicial do gestor e uma confirmação. Falhas intermediárias deixam a empresa inativa e oferecem **Concluir cadastro**, preservando a tentativa e exigindo a senha novamente. Repetir não altera uma credencial já criada. A empresa só é liberada com gestor e auditoria confirmados. O administrador central não ganha acesso operacional ou vínculo automático com a nova loja. Convite, envio de credenciais e recuperação de senha não fazem parte desta etapa.

**Navegação unificada (27/10/2026):** acessar `/` para o sistema e `/entrar/` para o único login real. Produtos, estoque, clientes, vendas, OS, compras, financeiro e equipe usam a mesma sessão/empresa e as permissões do servidor. `/operacao/` redireciona para `/produtos/`; `/importar/` para `/compras/`. Demonstração exclusivamente em `/demo/`, sem autenticação fictícia nem importação de seus dados locais. Fiscal, relatórios completos e parceiros ficam identificados como preparação. Evidências no [registro UNI](../docs/15-auditoria-acessos-e-filtros.md).

## Neon e Render: homologação

Configuração de 27/10/2026: projeto Neon `round-wind-47684434`, branch `production`, mantendo Better Auth do Sistem. O branch tem esse nome na plataforma, mas este ambiente é de homologação. `wandering-bar-87117671` não foi alterado. PostgreSQL usa `pg` e conexões **diretas**, pois o serviço de contas mantém advisory locks de sessão; conexão por pool transacional externo não preservaria esse contrato. Credenciais administrativas ficam somente nas ferramentas de preparação.

O CLI já criou `neon.ts`, vinculou `.neon` e executou `neon deploy`, que recebeu `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_BRANCH`, `NEON_AUTH_BASE_URL` e `NEON_AUTH_JWKS_URL` em `.env.local` privado. Neon Auth já habilitado foi preservado; essas duas últimas variáveis não substituem o login existente nem são consumidas pelo Sistem.

Na pasta `D:\SistemNF-e\web`, após o vínculo/autenticação no CLI:

```powershell
npm.cmd install
neon.cmd deploy
npm.cmd run setup:neon
```

`setup:neon` cria/reutiliza dois bancos próprios com marcador de ambiente, aplica as migrações e testa as conexões de runtime. Recusa banco ocupado sem seu marcador e roles privilegiadas, sem apagar dados. Roles, senhas, segredo de autenticação e ID da empresa são preservados em `server/.local/neon/round-wind-47684434/state.json`; mantenha esse arquivo privado para reaplicar a preparação. Não troque senhas manualmente para contornar conflitos. O runtime resultante fica em `.env.neon.local`, ignorado pelo Git; não contém a senha administrativa ou a senha do gestor. Este comando não cria um gestor padrão.

Para preparar **seu primeiro gestor**, informe os dados explicitamente no PowerShell, ainda em `web`:

```powershell
$env:SISTEM_OWNER_NAME = Read-Host "Nome do gestor"
$env:SISTEM_OWNER_EMAIL = Read-Host "E-mail do gestor"
$env:SISTEM_COMPANY_NAME = Read-Host "Nome da empresa de teste"
$neonOwnerSecret = Read-Host "Senha (mínimo 12 caracteres)" -AsSecureString
try {
  $env:SISTEM_OWNER_PASSWORD = [System.Net.NetworkCredential]::new("", $neonOwnerSecret).Password
  npm.cmd run setup:neon:owner
} finally {
  Remove-Item -LiteralPath Env:SISTEM_OWNER_PASSWORD -ErrorAction SilentlyContinue
  $neonOwnerSecret.Dispose()
}
npm.cmd run build
npm.cmd start
```

Abra `http://127.0.0.1:4000/`. A preparação não redefine senha, não promove conta por coincidência de e-mail e não cria outro gestor ao repetir. Uma falha entre criar identidade e confirmar vínculo pode exigir recuperação administrativa explícita; preserve identidade e registros da tentativa. O modo de desenvolvimento em duas portas (`web` 3000/API 4000) continua disponível. `npm start` local usa loopback; Render usa `0.0.0.0` e `PORT`.

No **Web Service Free do Render**, conectado ao repositório da pasta `web`:

| Campo | Valor |
|---|---|
| Root Directory | vazio se a raiz do repositório já é `web`; `web` somente se essa pasta estiver dentro do repositório remoto |
| Build Command | `npm ci --include=dev && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/health/ready` |
| `NODE_ENV` | `production` |
| `BETTER_AUTH_SECRET` | valor privado gerado em `.env.neon.local` |
| `CONTROL_DATABASE_URL` | valor privado gerado em `.env.neon.local` |
| `TENANT_DATABASE_URLS` | JSON gerado em `.env.neon.local`, sem as aspas simples externas do formato dotenv |

O Render fornece `RENDER_EXTERNAL_URL` e `PORT`; API e frontend usam essa mesma origem, com HTTPS e cookies seguros. Se houver `NEXT_PUBLIC_API_URL` antigo apontando para localhost/outra API, remova-o e faça novo build para usar a mesma origem. `API_BASE_URL` e `FRONTEND_ORIGIN`, se definidos explicitamente, devem corresponder à URL HTTPS atual. `APP_PUBLIC_URL` é alternativa explícita ao endereço fornecido pelo Render. Não colocar `DATABASE_URL` administrativa no ambiente de runtime do Render; copiar somente os três valores gerados acima. Não copiar `.env.local`, manifests ou senhas para o Git ou para variáveis `NEXT_PUBLIC_*`.

Teste remoto reproduzível: com Chrome instalado e porta 4000 livre, execute `npm.cmd run smoke:neon` na pasta `web`, após o build. Ele cria/reutiliza dois bancos QA próprios, separados dos dois bancos da aplicação, e mantém apenas dados fictícios neles. Não roda no build, não apaga bancos e não cria um gestor de teste no banco da sua empresa. Verifica login no navegador, sessão após reload, produto e auditoria no Neon, leitura em outro navegador, funcionário sem direito recebendo 403 e logout recebendo 401. Estado privado QA fica em `server/.local/neon/.../qa-state.json`, resultado sem credenciais em `server/.local/validation/neon-browser-result.json`. Evidências e limites em [documento 13](../docs/13-backend-primeiro-recorte.md).

Na preparação inicial não houve commit/push/deploy. Na continuidade de 27/10 o usuário autorizou a publicação: o serviço existente `SistemNF-e` em `https://sistemnf-e.onrender.com` foi confirmado no plano Free e recebeu os comandos/variáveis privados acima. O primeiro gestor da empresa foi preparado explicitamente; a senha inicial fica somente no arquivo privado local entregue ao usuário. Resultado da publicação e validação em HTTPS no [registro da etapa](../docs/13-backend-primeiro-recorte.md). O build antigo mostrado no erro não continha `/operacao/` nem `/acessos/`; ambas precisam aparecer no build publicado. Em outra instalação, credenciais e banco não são enviados automaticamente do computador para o Render.

Backend Node.js/TypeScript com Fastify, Better Auth e PostgreSQL. Fornece sessão real, vínculos e autorização por empresa, clientes, produtos, estoque, vendas, OS e compras, com versões e auditoria transacional. A área conectada Next.js está em `/operacao/`; a demonstração local continua independente.

Estado/testes e limites em [Primeiro recorte do backend](../docs/13-backend-primeiro-recorte.md), [Acessos e operação conectada](../docs/15-auditoria-acessos-e-filtros.md) e [Primeiro recorte financeiro](../docs/11-financeiro-primeiro-recorte.md). O painel `/acessos/` administra funcionários e permissões dos módulos conectados. Iniciar esta API não migra os dados da demonstração. O recorte financeiro conectado inclui acordos, parcelas, recebimentos manuais e caixa mínimo; emissão fiscal, séries individuais e peças/orçamento versionado de OS continuam pendentes.

## Desenvolvimento local no Windows

### Personalização da empresa — revisão local BR

O gestor configura logo/fundo/intensidade em Configurações → Personalização da loja; funcionários ativos veem a marca e quem consulta OS pode abrir seu comprovante. `tenant_005` guarda imagens normalizadas e configuração no banco operacional. Não há diretório de uploads, URL de imagem externa, bucket ou variável de ambiente nova. PNG/JPG/WebP de até1MiB por arquivo, normalizados no servidor; sem SVG/animação. API e contratos em [Personalização da empresa](../docs/20-personalizacao-da-empresa.md).

Código/testes são locais. Antes de publicar, reaplicar migrações com credencial administrativa em cada banco operacional configurado, incluindo vagas de novas empresas. Preservar o mapa adicional de conexões não migra esses bancos automaticamente. `npm.cmd run build` não executa migração nem provisiona serviço. Testes e smokes usam bancos isolados e imagens genéricas, sem carga no banco da empresa.

Use uma versão Node.js compatível com `engines` do manifesto. Em `D:\SistemNF-e\web\server`:

```powershell
npm.cmd install
npm.cmd run db:local
```

Esse terminal mantém somente o cluster da pasta `.local/development`, escutando em loopback. Ctrl+C encerra a instância que o comando iniciou, preservando seus dados. Não é serviço do Windows nem configuração global de PostgreSQL.

Em outro PowerShell, no mesmo diretório, informe o primeiro gestor explicitamente. Não grave sua senha no histórico do terminal:

```powershell
$env:SISTEM_OWNER_NAME = Read-Host "Nome do gestor"
$env:SISTEM_OWNER_EMAIL = Read-Host "E-mail do gestor"
$env:SISTEM_COMPANY_NAME = Read-Host "Nome da empresa"
$setupOwnerSecret = Read-Host "Senha do gestor (mínimo 12 caracteres)" -AsSecureString
try {
  $env:SISTEM_OWNER_PASSWORD = [System.Net.NetworkCredential]::new("", $setupOwnerSecret).Password
  npm.cmd run setup:local
} finally {
  Remove-Item -LiteralPath Env:SISTEM_OWNER_PASSWORD -ErrorAction SilentlyContinue
  $setupOwnerSecret.Dispose()
}
npm.cmd run dev
```

`setup:local` verifica se a conexão pertence ao diretório informado antes de alterar bancos. Prepara o banco central e um operacional, aplica migrações com credencial administrativa e gera `.local/development/api.env` com conexões de runtime. Os arquivos privados e credenciais de infraestrutura ficam ignorados pelo Git; a senha do gestor é processada pela biblioteca e não vai para esses arquivos nem para stdout.

Repetir a preparação preserva IDs, dados e senha anterior; informar outra senha não redefine a conta. Conta existente sem vínculo de gestor ativo é recusada, sem promoção ou reativação automática. Uma interrupção entre criar a identidade pela biblioteca e confirmar empresa/vínculo pode deixar identidade sem vínculo: o fluxo recusa promoção automática; sua recuperação administrativa precisa ser explícita. Não apagar contas como compensação sem verificar sua origem e uso.

A API usa `http://127.0.0.1:4000`, com origem de frontend explícita `http://127.0.0.1:3000`. Os scripts leem o arquivo gerado e, se existir, `.env` privado como configuração explícita adicional. O ambiente do processo tem precedência. `.env.example` não contém segredos ou credenciais padrão. Para outra infraestrutura use conexões/configuração explícitas e credencial de migração separada; não execute as ferramentas locais contra bancos de produção.

## Rotas deste recorte

- `/health/live` e `/health/ready`.
- `POST /api/auth/sign-in/email` e `POST /api/auth/sign-out`; signup e demais endpoints de autenticação não são públicos.
- `GET /api/v1/me`: identidade e empresas autorizadas, sem token ou conexão de banco no DTO.
- `GET/POST /api/v1/tenants/:tenantId/customers` e `GET/PATCH /api/v1/tenants/:tenantId/customers/:id`.
- `GET /api/v1/tenants/:tenantId/access-options`, `GET/POST .../members`, `PATCH .../members/:userId` e `GET .../access-audit`: administração da equipe exclusiva do gestor.
- `GET /api/v1/tenants/:tenantId/operations/:resource`, com produtos, estoque, vendas, OS, compras e técnicos; filtros/paginação no PostgreSQL.
- `POST .../operations/commands`, `POST .../operations/purchase-plan` e `GET .../operations/history`: comandos tipados, plano autoritativo de XML e histórico com autor/instante/antes/depois. Contratos completos no documento 15.

Mutações exigem sessão quando aplicável e `Origin` permitido, inclusive login/logout. Cookies são `HttpOnly`, `SameSite=Lax` e `Secure` fora do desenvolvimento HTTP em loopback. Vínculos e permissões são revalidados por requisição; por padrão `owner`/`operator` escrevem clientes e `viewer` consulta. O gestor personaliza ações de clientes e os direitos operacionais para atendimento/consulta; administração de equipe permanece exclusiva dos gestores. Pesquisa textual é literal e paginada. Alteração exige versão; inativação preserva o registro. A última conta de gestor ativo é protegida inclusive na concorrência.

O frontend utiliza a API loopback automaticamente somente quando ele próprio é aberto no loopback. Para outro endereço, configure `NEXT_PUBLIC_API_URL` antes de iniciar/buildar o frontend e a origem correspondente em `FRONTEND_ORIGIN`; esse valor público é somente a origem da API, nunca segredo. Fora do ambiente local a origem precisa de HTTPS. A infraestrutura deve manter frontend/API no mesmo site para o cookie `SameSite=Lax` funcionar; não enviar credenciais para um backend configurado por campo da tela ou parâmetro da URL. A tela `/acessos/` não redireciona o protótipo para o banco.

O cadastro de funcionário usa uma intenção com UUID estável, autor e conteúdo de negócio, sem senha persistida. Better Auth cria a identidade e uma chave interna prova sua origem; vínculo e auditoria administrativa confirmam juntos. Se houver falha após criar a identidade, repetir a mesma tentativa recupera o vínculo sem duplicar ou alterar a senha. Uma conta preexistente não é incorporada automaticamente. Fechar o formulário descarta a tentativa em memória; recuperação administrativa de uma intenção abandonada e fluxo de convite/recuperação de senha continuam pendentes. Não editar tabelas de identidade manualmente para contornar um conflito.

Cadastro e auditoria confirmam juntos no banco da empresa. Autor, empresa, versões e instantes vêm do servidor; nenhum formulário pode forjá-los. PATCH sem alteração efetiva não muda versão/data nem cria evento. Erros/logs são projetados sem body, query, cookies, conexão ou erro bruto. Isso não conclui auditoria e permissões de todos os módulos.

## Verificação e build

`npm.cmd test` seleciona automaticamente `test/*.test.ts` pelo glob nativo do Node, com uma suíte por vez e reporter que omite detalhes privados. Novos testes seguem esse sufixo; helpers/fixtures e smokes que exigem execução explícita ficam fora da descoberta. O projeto ainda não configura um comando de lint separado; tipagem, testes e compilação são verificações distintas.

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd start
```

Os testes usam somente clusters isolados em `.local/tests` e dados fictícios, encerrando as instâncias que iniciam. Não usar dados reais nessas fixtures. O reporter de teste preserva resultados/exit code sem imprimir corpos de asserção ou credenciais. Os testes `nfse-national-read-client.test.ts` geram PFX genérico temporário com OpenSSL: no Windows, usam o executável do Git em `C:\Program Files\Git\usr\bin\openssl.exe`; em outros sistemas, `openssl` do PATH. `SISTEM_TEST_OPENSSL` permite informar outro executável já instalado. Os ensaios HTTPS/mTLS só acessam loopback e confiam na CA de teste apenas no processo filho; não usam certificado de cliente nem chamam o governo. O build do servidor gera `dist`; inclua também `web/shared/purchase-planner.mjs` na distribuição, preservando a relação `server/dist` → `shared`. O planejador puro é compartilhado com a demonstração, sem importar o armazenamento local. O build Next.js continua separado na pasta pai.

O caminho fiscal escolhido é integração direta com a SEFIN Nacional. `src/nfse-national-read-client.ts` prepara somente a consulta de convênio municipal em produção restrita, exigindo PFX no servidor e sem chave de intermediário. Não existe rota pública, cadastro de certificado ou emissão nesse cliente. Certificado real, vínculo com a empresa, credenciamento e contrato autenticado ainda precisam ser validados; o sucesso dos testes TLS locais não é homologação oficial. Módulos, scripts, testes e credencial local do piloto NFE.io foram removidos; seu histórico no banco e a migração `tenant_006` já aplicada permanecem preservados, conforme [registro fiscal](../docs/08-etapa-fiscal-e-proximos-passos.md).

`src/nfse-dps-draft.ts` prepara separadamente uma DPS não assinada a partir de uma cópia de OS aprovada e dados fiscais declarados, sem acessar banco ou rede. O recorte aceita prestador PJ Simples ME/EPP com apuração integral no SN, sem regime especial, retenção, benefício ou desconto, em produção restrita e competência/emissão de 2026. O valor de serviço usa somente mão de obra; peças são informadas separadamente. Dados ausentes e cenários fora desse recorte são recusados, sem inventar alíquotas ou enquadramento. O regime da empresa piloto ainda não foi confirmado; as fixtures são genéricas.

`src/nfse-dps-validation.ts` usa `libxml2-wasm@0.7.2` e os XSDs oficiais inalterados em `resources/nfse/prodrest-20261020`, com hashes verificados, resolução restrita aos arquivos conhecidos e bloqueio de DTD/XXE, XInclude, esquemas externos e XML assinado. Preserve a relação `server/dist` → `server/resources` na distribuição. O teste do módulo compilado confirmou esse carregamento. A versão do pacote de homologação não é automaticamente válida em produção.

O gerador puro sempre mantém `readyForSubmission=false`: faltam assinatura/certificado, reserva de numeração, conferências municipais/cadastrais, classificação do serviço e regras RTC. Validação XSD é estrutural e não aprovação fiscal. A aprovação/versão recebida por essa função pura é uma declaração do chamador; ela própria não lê banco. Os 16 testes de DPS e os dez do cliente de consultas passaram localmente, sem chamada autenticada ao governo.

`src/nfse-dps-journal.ts` acrescenta serviço **interno** com `prepareDpsRequest`, `getDpsRequest` e `readDpsHistory`. O chamador precisa fornecer o pool selecionado e o acesso autenticado/autorizado atual; o contrato bruto desse serviço não é exposto por HTTP. A composição autenticada descrita abaixo compartilha seu cliente/transação, sem chamada aninhada. O módulo verifica o vínculo imutável `tenant_admission`, usa o mesmo lock dos comandos operacionais e confere aprovação, versão, cliente ativo/tipo e valor da OS no banco. Reaproveita o nome do cadastro, sem copiar senha, equipamento ou diagnóstico. Documento/endereço fiscal do tomador e CNPJ/regime do prestador continuam declarações não comprovadas cadastralmente.

`tenant_007` cria contadores, cópias fiscais, chaves de repetição e eventos. Número de DPS é texto de até 15 dígitos, sequencial por ambiente/município/CNPJ/série no banco selecionado. Reserva, XML validado, autoria/hora, evento e auditoria são atômicos. Uma OS só tem uma DPS nesse ambiente: conteúdo divergente é conflito, inclusive com outra chave, versão ou série. Repetição exata recupera o snapshot, mesmo após alterações posteriores na OS. XML, chaves e eventos não aceitam UPDATE/DELETE; contador confirmado não retrocede. A role de runtime usada nos testes não tem TRUNCATE. Uma transação abortada não constitui reserva e pode deixar seu número disponível; nenhuma reserva confirmada é reciclada.

O journal mantém `readyForSubmission=false` e retira apenas `DPS_NUMBER_NOT_RESERVED` das pendências. Os números são locais a esse banco: não há sincronização com outros sistemas, outro banco do mesmo CNPJ ou documentos já existentes no órgão. Antes de ativar transmissão será obrigatório definir a identidade fiscal autorizada, a série/numeração inicial e conferir o histórico oficial. Esse contador não é o número de NFS-e atribuído pelo governo. As migrações `tenant_007` a `tenant_010` foram validadas somente em PostgreSQL isolado; não foram aplicadas no Neon da empresa. Custódia, assinatura experimental persistida e cadastro protegido estão descritos abaixo; ativação no ambiente, journal de envio/reconciliação e homologação oficial continuam pendentes.

`src/fiscal-profile.ts` e `tenant_008` acrescentam perfil fiscal e identificação do tomador, versões imutáveis e recuperação de solicitações. PATCH exige `requestId` e `version`; omissão preserva e `null` limpa, sem default de regime ou taxa. Noop não muda versão/autoria/hora nem cria auditoria extra. Auditoria comum guarda somente IDs e nomes de campos. Campos completos significam apenas aptidão para preparar no recorte suportado, nunca homologação cadastral/tributária ou permissão de envio.

As rotas usam sessão, origem e vínculo atuais. `fiscal.read` consulta perfil/tomador e rascunhos; `fiscal.configure` exige consulta e configura dados; `fiscal.prepare` exige consulta fiscal e de OS, sem concessão de financeiro. Gestores recebem o catálogo, funcionários mantêm suas concessões anteriores. O painel de equipe oferece esses direitos com dependências explícitas; configuração não concede preparação.

Sob `/api/v1/tenants/:tenantId/fiscal`: GET/PATCH `/profile`, GET/PATCH `/customers/:id`, POST `/orders/:id/prepare`, GET `/orders/:id/draft`, GET `/drafts/:id`, GET `/drafts/:id/history` e GET `/drafts/:id/xml`. POST recebe só chave, versões da OS/perfil/tomador, competência e exceções opcionais de descrição/local do serviço. Não aceita valores, dados de emissor, numeração ou ator forjados. Emissão temporal é gerada uma vez no servidor, preservada no replay. Composição perfil/tomador→journal usa uma transação, com rollback da reserva se o vínculo final falhar. POST/metadata/histórico omitem XML; download XML usa direito de consulta atual e resposta privada. A consulta por OS recupera o rascunho após perder a chave no navegador, sem gerar outro número.

A interface conectada está em `/fiscal/` e `/fiscal/configuracao/`. Não usa armazenamento operacional no navegador. Município habitual do serviço precisa ser declarado separadamente do emissor; exceção por OS resolve somente esse campo. Competência/local excepcionais são limpos ao trocar OS. Percentual com vírgula é convertido textualmente para formato canônico, sem arredondar ou aceitar mais casas. Não existe botão de transmissão e o XML baixado é rascunho não assinado.

Verificações pertinentes: `node --import tsx --test --test-reporter=./test/redacted-reporter.mjs test/fiscal-profile.test.ts`; na raiz, `npm.cmd exec -- playwright test tests/fiscal-live.spec.ts`. O ensaio adicional `node --import tsx test/fiscal-browser-smoke.ts --run` exige frontend local em `127.0.0.1:3000` e porta `4000` livre; inicia API/Chrome/banco **isolados**, cria somente fixtures genéricas, não usa .env da empresa nem acessa o órgão fiscal, e encerra seus recursos. Frontend iniciado para esse ensaio deve ser encerrado por quem o iniciou. Os testes não comprovam emissão oficial.

`src/nfse-dps-signature.ts` implementa `signDpsOffline` e `verifyDpsOffline` como **experimento criptográfico interno**, com perfil explícito `experimental-rsa-sha256-c14n-v1`. Esse algoritmo foi escolhido localmente; o anexo/XSD corrente não confirma seu aceite na SEFIN para a NFS-e convencional. O perfil não tem fallback SHA1 nem aceita algoritmo livre, não está ligado ao HTTP/UI, não persiste assinatura no journal e não libera envio. A assinatura preserva os bytes originais de `infDPS`; a verificação usa uma referência literal única a esse nó, schema oficial, digest, RSA, certificado externo pinado e retorna o conteúdo efetivamente verificado.

PFX/senha são recebidos em memória pelo chamador confiável. `node-forge@1.4.2` interpreta PKCS12/ASN.1; C14N vem do `libxml2-wasm@0.7.2` e RSA/digest do Node. O certificado precisa ser X509v3, RSA de 2048–8192 bits, válido no instante fornecido pelo servidor, não-CA, com assinatura digital/não repúdio e CNPJ exato em OtherName `2.16.76.1.3.3`, correspondente ao emitente da DPS. CN textual, e-CPF/procuração e equivalência matriz/filial não substituem essa identidade neste recorte. Certificado genérico de QA só prova matemática, não ICP-Brasil, cadeia/LCR ou autorização fiscal.

XML sem assinatura e XML assinado têm validadores estruturais separados; o primeiro continua recusando assinatura. O verificador criptográfico recusa wrapping, IDs alternativos/duplicados, URI externa/vazia/XPointer, referências múltiplas, objetos/manifest/chaves alternativas, parâmetros de algoritmo extras, comentários/PI/DTD/XXE/XInclude, downgrade ou conteúdo/certificado adulterado. `xml-crypto@6.4.0` é dependência somente de testes para verificar independentemente o resultado; testes também conferem digest e SignedInfo canônicos conhecidos e RSA nativo.

**Limite obrigatório:** a primitiva síncrona aceita somente PFX confiável e previamente controlado, nunca upload público ou corpo de requisição. Há limites de tamanho/profundidade e de parâmetros KDF visíveis, porém os parâmetros escondidos em SafeContents criptografado não são totalmente limitados. Para execução interrompível, usar o executor interno abaixo. Limpeza de buffers é best-effort, sem garantia de apagar strings/cópias internas de Forge/KeyObject. Nenhum material privado é retornado ou registrado; XML inclui apenas o certificado público necessário à assinatura.

Todo resultado continua com `readyForSubmission=false`, `officialProfileConfirmed=false`, `trustChainVerified=false` e `revocationChecked=false`. Pendências também incluem custódia/isolamento, reserva/origem, município/cadastro, classificação e RTC. Passar na matemática não comprova validade fiscal. Testes: `node --import tsx --test --test-reporter=./test/redacted-reporter.mjs test/nfse-dps-signature.test.ts`, com certificados genéricos temporários OpenSSL (mesmo executável/configuração de teste do cliente de consultas). Runtime não usa OpenSSL externo e nenhum certificado de QA é instalado no sistema.

### Execução isolada da assinatura offline

`signDpsIsolated(input, { timeoutMs?, signal? })`, em `src/nfse-dps-isolation.ts`, recebe o mesmo input explícito da primitiva e retorna o mesmo resultado com `executionIsolated=true`. Assina em processo Node descartável; o supervisor não interpreta PFX nem canonicaliza XML. Prazo padrão de 15s, configurável entre 100ms e 60s, inclui startup/cálculo/encerramento. Uma tarefa simultânea por supervisor; outra recebe `SIGNING_BUSY`, sem fila ou repetição automática. São limites locais, não SLA ou coordenação entre réplicas.

Entrada/executável/loader são fixos e o filho não herda `NODE_OPTIONS`, `--env-file`, variáveis da aplicação ou debugger. PFX/senha passam somente por IPC limitado; stdin/stdout/stderr são ignorados. Timeout, cancelamento, erro e mensagem inválida encerram o filho com `SIGKILL`; a Promise e a capacidade só são liberadas após `close`. Sucesso exige resposta válida e saída limpa. Erros públicos vêm de catálogo fechado, sem detalhe de bibliotecas ou senha. As flags de validação fiscal continuam falsas e as pendências da primitiva são preservadas.

Os dois arquivos de execução separam a supervisão do cálculo por necessidade de interrupção real. Não são um serviço genérico de tarefas. Fonte TS usa o loader `tsx` controlado; o artefato `dist` executa JS sem loader/dev dependency. Esse processo não é sandbox de filesystem/rede e não protege contra queda abrupta do pai; não há garantia de limpeza de toda cópia de memória ou quota total de memória nativa/WASM. `--max-old-space-size=128` limita apenas o heap V8. O mesmo executor agora oferece `inspectA1Isolated`, sem fabricar uma DPS para inspecionar o certificado; inspeção e assinatura compartilham a única vaga. Cadastro protegido por HTTP e preparação das chaves estão descritos abaixo; supervisão de produção e validação ICP-Brasil/revogação continuam pendentes.

### Custódia A1 interna e uso offline

`src/nfse-a1-custody.ts` oferece `readA1Certificate(access)`, `saveA1Certificate(access, keyring, command, options?)` e `signDpsWithStoredA1(access, keyring, draftId, options?)`. São funções internas, sem rota, upload ou tela. O chamador confiável continua responsável por autenticação/autorização atual e seleção do pool; a transação também confere `tenant_admission`. Consulta retorna somente metadados, nunca material privado.

O comando contém `requestId`, versão esperada do certificado (zero no primeiro cadastro), `profileVersion`, `issuerCnpj` e `credentials: { pfx: Buffer, passphrase: string }`. CNPJ precisa coincidir com perfil e certificado. A inspeção ocorre no filho, sem reter conexão; o commit revalida perfil e versões. Material idêntico com a mesma chave ativa preserva versão/autoria/hora. Uma nova chave ativa reencifra e incrementa a versão.

`keyring` é configuração dedicada do servidor em memória: `activeKeyId` e mapa de até quatro chaves de 32 bytes. Não deve vir da requisição, do banco nem do segredo de login. Esta etapa não cria/carrega chaves reais nem define configuração de implantação. Guardar/recuperar e rotacionar essas chaves com controle de acesso e backup protegido é pré-requisito operacional; perder a chave torna o material correspondente irrecuperável. Não há fallback, reset silencioso ou promessa de HSM.

`tenant_009` guarda PFX/senha somente cifrados com AES-256-GCM e contexto autenticado da empresa/versão/metadados. HKDF separa empresas e os usos de cifragem/MAC. Pedidos imutáveis autenticam intenção e snapshot, permitindo recuperar o resultado original após alterações; replay antigo requer sua chave histórica ainda disponível. Auditoria comum guarda IDs/versões/campos, sem CNPJ, XML ou credenciais. Buffers são limpos por melhor esforço; strings/cópias internas e rollback completo por administrador do banco/host não têm garantia de apagamento/detecção. O cadastro protegido abaixo compõe essas funções sem disponibilizar o material privado para download.

A assinatura efêmera de `signDpsWithStoredA1` lê uma DPS imutável já armazenada, libera a conexão antes do filho e recusa mudança concorrente do A1 ao finalizar. Uso possui sequência de auditoria própria, preservando a versão/numeração da DPS. O retorno traz XML assinado experimental, draft e versão/fingerprint do certificado, com `signaturePersisted=false` e as quatro flags de prontidão/confiança falsas. Essa função não anexa assinatura ao journal nem envia ao órgão; a persistência é uma composição separada descrita abaixo. Cadastro protegido está descrito abaixo; cadeia/revogação, perfil oficial e transmissão/reconciliação continuam pendentes.

Teste direcionado: `node --import tsx --test --test-reporter=./test/redacted-reporter.mjs test/nfse-a1-custody.test.ts`. Usa somente PostgreSQL e certificados genéricos descartáveis. [Critérios, resultados e limitações](../docs/08-etapa-fiscal-e-proximos-passos.md#nfsd-a1--custódia-cifrada-interna-e-uso-offline--04112026).

### Assinatura offline persistida

`saveSignedDpsRequest(access, keyring, { requestId, draftId, certificateVersion }, options?)`, no coordenador de custódia, prepara e guarda **um artefato experimental por DPS**. O comando não aceita XML, perfil, ator ou material privado. `tenant_010` acrescenta assinatura e pedidos imutáveis; FKs compostas vinculam a empresa ao rascunho/artefato. A assinatura guarda hashes dos bytes originais e assinados, perfil, versão/fingerprint do A1 e autoria/hora. Não altera XML, versão ou número da DPS original.

Assinatura nova exige a versão esperada do A1 antes do cálculo e novamente ao gravar. O executor trabalha sem conexão de banco; artefato, pedido, auditoria de guarda e auditoria de uso confirmam juntos no mesmo cliente/transação, conforme o [contrato do driver](https://node-postgres.com/features/transactions). O helper de finalização é privado e tem apenas os dois consumidores reais: assinatura efêmera existente e assinatura persistida. Não há callback executável fornecido por API.

Repetição exata devolve o snapshot original. Nova chave equivalente acrescenta somente vínculo de pedido, preservando autoria/hora; o ator do novo vínculo fica no pedido. Nova intenção/ator na mesma chave ou outra versão do certificado na mesma DPS retorna conflito, sem ressignatura/substituição. Recuperação ocorre antes de exigir o certificado atual, inclusive no commit após cálculo concorrente. Não depende da chave histórica de cifragem; a função de gravação ainda recebe um keyring válido de configuração interna. Consultas do documento já guardado não recebem keyring.

`getSignedDpsMetadata(access, draftId)` e `getSignedDpsXml(access, draftId)`, em `src/nfse-dps-signature-journal.ts`, são leituras internas com vínculo do banco/empresa. O chamador continua responsável pela autenticação/autorização atual. Metadados retornam `null` para rascunho existente sem assinatura; draft inexistente ou XML ainda ausente retorna `NOT_FOUND`. A consulta de metadados não seleciona XML; o download é separado. DTO persistido tem `signaturePersisted=true` e mantém prontidão/perfil oficial/cadeia/revogação falsos. XML contém certificado público; PFX/senha/chaves continuam somente na custódia cifrada e em memória de execução, nunca neste journal ou na auditoria comum.

A função original `signDpsWithStoredA1` permanece efêmera (`signaturePersisted=false`). Cadastro HTTP/UI e preparação do arquivo de chaves estão descritos abaixo; ativação/backup do ambiente, cadeia/revogação, confirmação do perfil oficial, journal de transmissão/reconciliação e homologação autenticada continuam pendentes. Hashes e triggers não prometem resistência à reescrita completa por administrador do banco/host. `tenant_010` foi executada somente em bancos genéricos isolados, sem alteração do Neon da empresa.

Teste direcionado: `node --import tsx --test --test-reporter=./test/redacted-reporter.mjs test/nfse-dps-signature-journal.test.ts`. O caso de escritor concorrente simula outro supervisor por SQL no banco de QA; não constitui ensaio de dois servidores publicados. [Aceite, resultados e pendências](../docs/08-etapa-fiscal-e-proximos-passos.md#nfsd-sp--assinatura-offline-persistida--05112026).

### Cadastro protegido do certificado A1

Implementado localmente em `/fiscal/configuracao/`, sem publicação. O gestor, ou funcionário com `fiscal.certificates.manage`, seleciona PFX/P12 e informa a senha; CNPJ vem do perfil fiscal salvo. Uma confirmação envia o material para inspeção isolada e custódia cifrada. O certificado não fica em arquivo temporário, não pode ser baixado e não habilita emissão oficial. Consulta de metadados requer `fiscal.read`; gestão exige também consulta/configuração. Funcionários não recebem a nova concessão automaticamente.

`GET /api/v1/tenants/:tenantId/fiscal/certificate` retorna `storageConfigured` e metadados ou `null`. `PATCH` recebe somente `requestId`, `version`, `profileVersion`, `pfxBase64` e `passphrase`. Autorização/origem são conferidas antes de interpretar o corpo e a autorização é revalidada depois do recebimento. JSON limitado a 1.450.000 bytes, PFX a 1 MiB e senha a 1024 caracteres. Inspeção mantém deadline próprio de 15s; há deadline de 20s desde a reserva da vaga HTTP, uma vaga por instância e dez tentativas por ator/empresa/minuto. Abortos/erros liberam a vaga; cálculo em voo precisa encerrar antes de liberar. Isso não constitui limite distribuído entre réplicas.

Repetição usa CNPJ da versão histórica do perfil filtrada por empresa, sem redigitação e sem contornar o conflito de um cadastro novo com perfil antigo. Conflito de certificado oferece atualização explícita dos metadados preservando arquivo/senha; perfil alterado exige recarregar os dados e selecionar o material de novo. Não há substituição ou reenvio automático. Sucesso, 401/403 ou saída do contexto limpam campos; respostas e leitura de arquivo atrasadas são descartadas. Somente o ID da intenção é mantido em memória para repetir; PFX/senha não entram em storage/cache de intenções. Apagamento de strings/cópias do browser/Forge não é garantido.

O serviço fica desabilitado para gravação até configurar um **arquivo de chaves dedicado no servidor**, por `NFS_E_A1_KEYRING_FILE`. A variável contém só o caminho absoluto. Nenhuma chave é gerada automaticamente ou derivada do segredo de login. Arquivo configurado inválido falha na inicialização; ausência da variável mantém os demais módulos disponíveis. O loader limita leitura a 2048 bytes, recusa arquivo não regular/symlink e exige proprietário do processo e modo Unix `0400`/`0600`. Em Windows, os testes/desenvolvimento não comprovam ACL: valide proteção de acesso antes de usar material real nesse ambiente. O arquivo nunca deve estar em fonte, artefato público ou variável `NEXT_PUBLIC_*`.

Preparação **explícita e offline**, na pasta `web/server`, com destinos novos na pasta ignorada `.local` (sem imprimir as chaves):

```powershell
npm.cmd run a1:keys -- --output 'D:\SistemNF-e\web\server\.local\a1-keyring-v1.json' --key-id key_2026_01
```

Para preparar uma próxima chave ativa, preservando as anteriores e sem modificar a origem:

```powershell
npm.cmd run a1:keys -- --source 'D:\SistemNF-e\web\server\.local\a1-keyring-v1.json' --output 'D:\SistemNF-e\web\server\.local\a1-keyring-v2.json' --key-id key_2026_02
```

Esses comandos **não foram executados para a empresa**. A ferramenta recusa sobrescrita, ID repetido e quinta chave; mantenha backup privado separado do banco. Perder uma chave impede recuperar o material correspondente. Trocar a chave ativa requer fornecer o arquivo atualizado ao servidor e reiniciar; não reencifra certificados antigos automaticamente. Enquanto houver material/replays dependentes, preserve as chaves históricas. A retirada de chaves antigas não é automática.

O [Render documenta secret files](https://render.com/docs/configure-environment-variables#secret-files) em `/etc/secrets/<nome>`. Antes de habilitar, confirme proprietário/modo compatíveis e HTTPS real na implantação; a montagem/permissões/TLS do Render não foram validados nesta etapa. Não relaxe o loader ou reutilize segredo de autenticação para ativar o recurso. Nenhum arquivo/chave real ou configuração remota foi criado. Controles de [upload](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html) e [separação de chaves/dados](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html) foram consultados; arquivo protegido não equivale a HSM.

Verificações: `nfse-a1-keyfile.test.ts`, `nfse-a1-http.test.ts`, `nfse-a1-transport.test.ts` e `tests/fiscal-certificate.spec.ts`, além da regressão de acessos/fiscal. Testes usam somente bancos/chaves/PFX genéricos. [Critérios, resultados e limites](../docs/08-etapa-fiscal-e-proximos-passos.md#nfsd-cert--cadastro-protegido-do-a1--05112026).

`tenant_002` acrescenta registros operacionais, saldos, movimentos, tentativas idempotentes e valores de auditoria, sem reescrever clientes ou `tenant_001`. Migrações são explícitas nas ferramentas de preparação, nunca executadas por uma requisição HTTP. Instâncias já preparadas precisam reaplicar `setup:local` com os dados explícitos do mesmo gestor para receber a nova migração; não apague bancos para atualizar.

Há 19 direitos operacionais adicionais. Gestores recebem o catálogo completo; funcionários existentes mantêm suas concessões anteriores até configuração explícita. O painel oferece **Aplicar rotina de balcão**, sem conceder custos ou compras. A API valida dependências entre direitos e revalida o vínculo em cada chamada. Criação de cliente aceita `requestId` opcional para recuperar a mesma tentativa no cadastro contextual sem duplicar registros.

Esta preparação não publica serviço, configura HTTPS/rede, envia convites, migra localStorage ou cria usuários com credenciais reais fornecidas por terceiros. Acesso de outros computadores exige infraestrutura e configuração apropriadas; loopback é apenas o ambiente local de desenvolvimento.

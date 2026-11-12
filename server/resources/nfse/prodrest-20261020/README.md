# Referência oficial de DPS e NFS-e — produção restrita

Origem: [pacote oficial de homologação de 20/10/2026](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/producao-restrita/esquemas_prod_restrita_20261020.zip), publicado na [documentação de testes da NFS-e](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/producao-restrita). Os quatro XSDs necessários à DPS foram preservados; em10/11/2026 foi acrescentado `NFSe_v1.01.xsd`, do mesmo arquivo oficial, para inspeção estrutural de resposta. Os cinco mantêm seus bytes originais. Não são schemas criados pelo Sistem.

`manifest.json` identifica fonte, ambiente, data e hashes SHA-256. Seu próprio hash está fixado em `server/src/nfse-xml-schema.ts`, loader compartilhado por DPS e inspeção NFS-e. `.gitattributes` evita conversão de fim de linha nesses recursos. Atualização exige conferência da origem/bytes, atualização explícita do manifesto/pin e testes; não substituir silenciosamente estes arquivos ou misturar versões de pacotes.

Este pacote é para **produção restrita**. Não comprova compatibilidade com o ambiente de produção nem com regras futuras. O XSD verifica estrutura; não comprova situação cadastral, tributação, enquadramento de serviço, assinatura ou autorização. A assinatura opcional no XSD não torna uma DPS não assinada apta à transmissão.

Na distribuição, manter esta pasta na relação `server/dist` → `server/resources`. Não há download de schema em runtime, dados de empresa ou certificados neste diretório. Os dois validadores usam um único resolver da biblioteca XML, limitado aos cinco recursos fixos, sem fallback de filesystem/rede. Não registrar um segundo resolver concorrente ao adicionar outro consumidor; ampliar escopo exige revisão. Inspeção da NFS-e confere estrutura e correlação com a DPS, mantendo assinatura/confiança/contrato/autorização não verificados.

A conferência matemática de assinatura é uma chamada separada (`verifyNfseCandidateSignature`), com certificado esperado fora do XML. Ela não altera estes XSDs nem transforma validação estrutural em prova de identidade institucional, cadeia ou autorização.

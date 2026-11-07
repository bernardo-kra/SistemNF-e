# Referência oficial de DPS — produção restrita

Origem: [pacote oficial de homologação de 20/10/2026](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/producao-restrita/esquemas_prod_restrita_20261020.zip), publicado na [documentação de testes da NFS-e](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/producao-restrita). Os quatro XSDs necessários à DPS foram extraídos sem alterar seus bytes. Não são schemas criados pelo Sistem.

`manifest.json` identifica fonte, ambiente, data e hashes SHA-256. Seu próprio hash está fixado no validador. `.gitattributes` evita conversão de fim de linha nesses recursos. Atualização exige novo pacote/versionamento, conferência das fontes e testes; não substituir silenciosamente estes arquivos.

Este pacote é para **produção restrita**. Não comprova compatibilidade com o ambiente de produção nem com regras futuras. O XSD verifica estrutura; não comprova situação cadastral, tributação, enquadramento de serviço, assinatura ou autorização. A assinatura opcional no XSD não torna uma DPS não assinada apta à transmissão.

Na distribuição, manter esta pasta na relação `server/dist` → `server/resources`. Não há download de schema em runtime, dados de empresa ou certificados neste diretório. O uso atual da biblioteca XML tem um resolver que permite somente os recursos fixos; reavaliar seu escopo antes de compartilhar a mesma instância com outros consumidores XML.

// Generic, isolated fiscal fixtures. These are not the user's company or a tax recommendation.
export const dpsId = "DPS" + "3550308" + "2" + "11222333000181" + "00001" + "000000000000001";
export const unsignedDpsXml = `<?xml version="1.0" encoding="UTF-8"?>
<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infDPS Id="${dpsId}">
<tpAmb>2</tpAmb><dhEmi>2026-10-29T10:00:00-03:00</dhEmi><verAplic>Sistem-QA</verAplic><serie>1</serie><nDPS>1</nDPS><dCompet>2026-10-28</dCompet><tpEmit>1</tpEmit><finNFSe>0</finNFSe><cLocEmi>3550308</cLocEmi>
<prest><CNPJ>11222333000181</CNPJ><regTrib><opSimpNac>3</opSimpNac><regApTribSN>1</regApTribSN><regEspTrib>0</regEspTrib></regTrib></prest>
<toma><CPF>52998224725</CPF><xNome>Cliente QA</xNome></toma>
<serv><locPrest><cLocPrestacao>3550308</cLocPrestacao></locPrest><cServ><cTribNac>140101</cTribNac><xDescServ>Reparo genérico de QA</xDescServ></cServ></serv>
<valores><vServPrest><vServ>123.45</vServ></vServPrest><trib><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>1</tpRetISSQN></tribMun><totTrib><pTotTribSN>4.12</pTotTribSN></totTrib></trib></valores>
</infDPS></DPS>`;

export function draftInput(): Record<string, any> {
  return {
    environment: "production-restricted", schemaId: "nfse-prodrest-20261020",
    issuance: { series: "1", number: "1", issuedAt: "2026-10-29T10:00:00-03:00", competence: "2026-10-28", applicationVersion: "Sistem-QA" },
    source: { type: "order", id: "10000000-0000-4000-8000-000000000001", version: 1, approved: true, laborCents: 12345, partsCents: 6789 },
    issuer: { cnpj: "11222333000181", municipalityCode: "3550308", regime: { opSimpNac: "3", regApTribSN: "1", regEspTrib: "0" } },
    customer: { document: { type: "CPF", value: "52998224725" }, name: "Cliente QA" },
    service: { municipalityCode: "3550308", nationalTaxCode: "140101", description: "Reparo genérico de QA" },
    taxation: { issTaxation: "1", issWithholding: "1", approxSimplesRate: "4.12" },
  };
}

import { dpsId, unsignedDpsXml } from "./nfse-dps-fixture.ts";

// Generic STRUCTURAL fixture only. AA== is not a valid cryptographic signature/certificate.
// Candidate IDs and status never represent a real issued invoice or a verified check digit.
export const candidateKey = "3550308" + "2" + "2" + "11222333000181" + "0000000000001" + "2611" + "000000001" + "0";
export function structuralSignature(id: string) {
  return `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo><CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/><SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/><Reference URI="#${id}"><Transforms><Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/></Transforms><DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><DigestValue>AA==</DigestValue></Reference></SignedInfo><SignatureValue>AA==</SignatureValue><KeyInfo><X509Data><X509Certificate>AA==</X509Certificate></X509Data></KeyInfo></Signature>`;
}
export const structuralSignedDps = unsignedDpsXml.replace("</DPS>", structuralSignature(dpsId) + "</DPS>");
export function candidateXml(dps = structuralSignedDps) {
  return `<?xml version="1.0" encoding="UTF-8"?><NFSe xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infNFSe Id="NFS${candidateKey}">
<xLocEmi>Município genérico QA</xLocEmi><xLocPrestacao>Município genérico QA</xLocPrestacao><nNFSe>1</nNFSe><xTribNac>Serviço genérico QA</xTribNac><verAplic>QA</verAplic><ambGer>2</ambGer><tpEmis>1</tpEmis><cStat>100</cStat><dhProc>2026-11-10T10:00:00+00:00</dhProc><nDFSe>1</nDFSe>
<emit><CNPJ>11222333000181</CNPJ><xNome>Emitente genérico QA</xNome><enderNac><xLgr>Rua QA</xLgr><nro>1</nro><xBairro>Centro QA</xBairro><cMun>3550308</cMun><UF>SP</UF><CEP>01001000</CEP></enderNac></emit><valores><vLiq>123.45</vLiq></valores>
${dps.replace(/<\?xml[^?]*\?>\s*/, "")}</infNFSe>${structuralSignature("NFS" + candidateKey)}</NFSe>`;
}

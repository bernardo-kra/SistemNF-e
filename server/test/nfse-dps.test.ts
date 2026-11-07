import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { XmlDocument } from "libxml2-wasm";
import { dpsId, draftInput, unsignedDpsXml } from "./nfse-dps-fixture.ts";

const validation = () => import("../src/nfse-dps-validation.ts");
const preparation = () => import("../src/nfse-dps-draft.ts");
const ns = { n: "http://www.sped.fazenda.gov.br/nfse" };
function at(xml: string, xpath: string) { const doc = XmlDocument.fromString(xml); try { return doc.get(xpath, ns)?.content; } finally { doc.dispose(); } }
function safe(error: any, code?: string) { if (code) assert.equal(error.code, code); assert.equal(error.cause, undefined); assert.ok(!String(error).includes("qa-private-marker")); assert.ok(!JSON.stringify(error).includes("qa-private-marker")); return true; }

test("DPS01 ID segue composição oficial com CNPJ numérico, alfanumérico e CPF sem perda", async () => {
  const { createDpsId } = await validation();
  assert.equal(createDpsId({ municipalityCode: "3550308", documentType: "CNPJ", document: "11222333000181", series: "1", number: "1" }), dpsId);
  const alpha = createDpsId({ municipalityCode: "3550308", documentType: "CNPJ", document: "12ABC34501DE35", series: "49999", number: "999999999999999" });
  assert.equal(alpha, "DPS35503082" + "12ABC34501DE35" + "49999" + "999999999999999"); assert.equal(alpha.length, 45);
  assert.equal(createDpsId({ municipalityCode: "3550308", documentType: "CPF", document: "52998224725", series: "1", number: "1" }), "DPS35503081" + "00052998224725" + "00001" + "000000000000001");
});

test("DPS02 documento inválido, série fora da faixa ERP e número ambíguo são recusados", async () => {
  const { createDpsId } = await validation(); const base = { municipalityCode: "3550308", documentType: "CNPJ", document: "11222333000181", series: "1", number: "1" };
  for (const patch of [{ document: "00000000000000" }, { document: "11222333000182" }, { document: "12ABC34501DE36" }, { document: "qa-private-marker" }, { series: "0" }, { series: "50000" }, { series: "01" }, { number: "0" }, { number: "01" }, { number: "1000000000000000" }, { number: 1 }, { municipalityCode: "../3550308" }, { documentType: "NIF" }]) assert.throws(() => createDpsId({ ...base, ...patch } as any), e => safe(e, "INVALID_DPS_IDENTIFIER"));
});

test("DPS03 fixture independente valida no XSD oficial fixado e continua não transmissível", async () => {
  const { validateUnsignedDpsXml } = await validation();
  assert.deepEqual(validateUnsignedDpsXml(unsignedDpsXml), { schemaId: "nfse-prodrest-20261020", structurallyValid: true, readyForSubmission: false });
});

test("DPS04 XSD recusa elemento ausente, extra, valor inválido e estrutura truncada sem revelar XML", async () => {
  const { validateUnsignedDpsXml } = await validation();
  for (const xml of [unsignedDpsXml.replace("<finNFSe>0</finNFSe>", ""), unsignedDpsXml.replace("</infDPS>", "<extra>qa-private-marker</extra></infDPS>"), unsignedDpsXml.replace("123.45", "-1.00"), unsignedDpsXml.replace("</DPS>", ""), unsignedDpsXml.replace('versao="1.01"', 'versao="9.99"')]) assert.throws(() => validateUnsignedDpsXml(xml), e => safe(e));
});

test("DPS05 produção, assinatura, prefixos e identidade divergente não passam pelo validador de rascunho", async () => {
  const { validateUnsignedDpsXml } = await validation();
  for (const xml of [unsignedDpsXml.replace("<tpAmb>2", "<tpAmb>1"), unsignedDpsXml.replace("</DPS>", '<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"/></DPS>'), unsignedDpsXml.replace('<DPS xmlns=', '<n:DPS xmlns:n=').replace('</DPS>','</n:DPS>'), unsignedDpsXml.replace(dpsId, dpsId.slice(0,-1)+"2")]) assert.throws(() => validateUnsignedDpsXml(xml), e => safe(e));
});

test("DPS06 DTD, entidades, XInclude, schemaLocation e XML excessivo são bloqueados antes de resolver recursos", async () => {
  const { validateUnsignedDpsXml } = await validation();
  const body = unsignedDpsXml.replace(/<\?xml[^?]+\?>/, "");
  for (const xml of ['<!DOCTYPE DPS SYSTEM "https://example.test/qa-private-marker">'+body, '<!DOCTYPE DPS [<!ENTITY x SYSTEM "file:///qa-private-marker">]>'+body.replace("Cliente QA","&x;"), body.replace("</infDPS>", '<xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="file:///qa-private-marker"/></infDPS>'), body.replace('<DPS ', '<DPS xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.sped.fazenda.gov.br/nfse https://example.test/qa-private-marker" '), " ".repeat(128 * 1024 + 1)]) assert.throws(() => validateUnsignedDpsXml(xml), e => safe(e, "UNSAFE_DPS_XML"));
});

test("DPS07 pacote XSD local corresponde aos hashes da referência oficial", async () => {
  const root = new URL("../resources/nfse/prodrest-20261020/", import.meta.url), manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
  assert.equal(manifest.environment, "production-restricted"); assert.equal(manifest.publishedPackage, "2026-10-20");
  for (const [name, hash] of Object.entries(manifest.files)) assert.equal(createHash("sha256").update(await readFile(new URL(name, root))).digest("hex"), hash);
});

test("DPS08 XSD estrutural não é aprovação de regra fiscal nem autorização de nota", async () => {
  const { validateUnsignedDpsXml } = await validation();
  // A choice estrutural permite este indicador, mas RN E0712 proíbe seu uso no subset ME/EPP.
  const result = validateUnsignedDpsXml(unsignedDpsXml.replace("<pTotTribSN>4.12</pTotTribSN>", "<indTotTrib>0</indTotTrib>"));
  assert.equal(result.structurallyValid, true); assert.equal(result.readyForSubmission, false);
});

test("DPS09 rascunho usa só mão de obra, preserva origem e não inclui peças, pagamento ou segredos", async () => {
  const { prepareOrderDpsDraft } = await preparation(); const input = draftInput(), before = structuredClone(input);
  const draft = prepareOrderDpsDraft(input);
  assert.deepEqual(input, before); assert.equal(draft.state, "unsigned_draft"); assert.equal(draft.id, dpsId); assert.equal(draft.readyForSubmission, false);
  assert.equal(draft.serviceAmountCents, 12345); assert.equal(draft.excludedPartsCents, 6789); assert.deepEqual(draft.source, { id: input.source.id, version: 1 });
  assert.equal(at(draft.xml, "/n:DPS/n:infDPS/n:valores/n:vServPrest/n:vServ"), "123.45");
  for (const forbidden of ["vReceb", "vAjusteBC", "pAliq", "indTotTrib", "IBSCBS", "6789", "Signature"]) assert.ok(!draft.xml.includes(forbidden));
  assert.ok(draft.pendingChecks.includes("RTC_RULES_UNVERIFIED")); assert.ok(draft.pendingChecks.includes("DPS_NUMBER_NOT_RESERVED"));
});

test("DPS10 dado fiscal ausente não recebe regime, classificação ou percentual inventado", async () => {
  const { prepareOrderDpsDraft } = await preparation();
  for (const path of [["issuer","regime"],["issuer","cnpj"],["service","nationalTaxCode"],["taxation","approxSimplesRate"],["issuance","competence"],["customer","document"]]) { const input=draftInput();delete input[path[0]][path[1]];assert.throws(()=>prepareOrderDpsDraft(input),e=>safe(e)); }
});

test("DPS11 exceções tributárias e operações fora do subset são recusadas sem adaptação silenciosa", async () => {
  const { prepareOrderDpsDraft } = await preparation();
  const edits = [ (v:any)=>v.issuer.regime.opSimpNac="1", (v:any)=>v.issuer.regime.opSimpNac="2", (v:any)=>v.issuer.regime.regApTribSN="2", (v:any)=>v.issuer.regime.regEspTrib="1", (v:any)=>v.taxation.issTaxation="2", (v:any)=>v.taxation.issWithholding="2", (v:any)=>v.taxation.pAliq="0.00", (v:any)=>v.taxation.tribFed={}, (v:any)=>v.taxation.approxSimplesRate=0, (v:any)=>v.service.discountCents=100, (v:any)=>v.ibsCbs={} ];
  for(const edit of edits){const input=draftInput();edit(input);assert.throws(()=>prepareOrderDpsDraft(input),e=>safe(e));}
});

test("DPS12 OS sem aprovação, valor inválido ou metadados inválidos não geram DPS", async () => {
  const { prepareOrderDpsDraft } = await preparation();
  for(const patch of [{approved:false},{laborCents:0},{laborCents:-1},{laborCents:1.2},{laborCents:Number.MAX_SAFE_INTEGER+1},{laborCents:"12345"},{partsCents:-1},{version:0},{type:"sale"},{id:"qa-private-marker"}]){const input=draftInput();Object.assign(input.source,patch);assert.throws(()=>prepareOrderDpsDraft(input),e=>safe(e));}
});

test("DPS13 competência é explícita, calendário/fuso reais e período do pacote é respeitado", async () => {
  const { prepareOrderDpsDraft } = await preparation();
  for(const patch of [{competence:"2026-02-29"},{competence:"2026-10-30"},{issuedAt:"2026-02-30T10:00:00-03:00"},{issuedAt:"2026-10-29T10:00:00"},{competence:"2027-01-01",issuedAt:"2027-01-02T10:00:00-03:00"}]){const input=draftInput();Object.assign(input.issuance,patch);assert.throws(()=>prepareOrderDpsDraft(input),e=>safe(e));}
  for(const patch of [{environment:"production"},{schemaId:"nfse-production"}])assert.throws(()=>prepareOrderDpsDraft({...draftInput(),...patch}),e=>safe(e));
});

test("DPS14 textos são escapados, centavos são exatos e alteração posterior não reescreve rascunho", async () => {
  const { prepareOrderDpsDraft } = await preparation();const input=draftInput();input.customer.name='QA & Filhos <Teste>';input.service.description='Serviço <script> & "especial"';input.source.laborCents=1;
  const draft=prepareOrderDpsDraft(input);input.source.laborCents=99999;input.customer.name="Alterado";
  assert.equal(at(draft.xml,"/n:DPS/n:infDPS/n:toma/n:xNome"),'QA & Filhos <Teste>');assert.equal(at(draft.xml,"/n:DPS/n:infDPS/n:valores/n:vServPrest/n:vServ"),"0.01");assert.equal(draft.serviceAmountCents,1);assert.ok(!draft.xml.includes('<script>'));
});

test("DPS15 código/descrição inválidos e dados de senha não são escondidos ou copiados", async () => {
  const { prepareOrderDpsDraft } = await preparation();
  for(const edit of [(v:any)=>v.service.description="",(v:any)=>v.service.nationalTaxCode="14.01",(v:any)=>v.service.description="x".repeat(2001),(v:any)=>v.source.unlockPassword="qa-private-marker",(v:any)=>v.taxation.approxSimplesRate="4,12"]){const input=draftInput();edit(input);assert.throws(()=>prepareOrderDpsDraft(input),e=>safe(e));}
});

test("DPS16 endereço e códigos opcionais conhecidos são reutilizados; peças desconhecidas não viram zero", async () => {
  const { prepareOrderDpsDraft } = await preparation();const input=draftInput();delete input.source.partsCents;
  input.customer.address={municipalityCode:"3550308",postalCode:"01001000",street:"Rua de QA",number:"10",district:"Centro"};input.service.municipalTaxCode="001";input.service.nbsCode="120011000";
  const draft=prepareOrderDpsDraft(input);assert.equal(draft.excludedPartsCents,null);assert.equal(at(draft.xml,"/n:DPS/n:infDPS/n:toma/n:end/n:endNac/n:CEP"),"01001000");assert.equal(at(draft.xml,"/n:DPS/n:infDPS/n:serv/n:cServ/n:cTribMun"),"001");
});

import assert from "node:assert/strict";
import { before, test } from "node:test";
import { createHash, randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { candidateKey, candidateXml, structuralSignature, structuralSignedDps } from "./nfse-response-fixture.ts";
import { dpsId, unsignedDpsXml } from "./nfse-dps-fixture.ts";

const load = (): Promise<typeof import("../src/nfse-response-validation.ts")> => process.env.SISTEM_QA_COMPILED_RESPONSE === "true"
  ? import(new URL("../dist/nfse-response-validation.js", import.meta.url).href) : import("../src/nfse-response-validation.ts");
let inspect: Awaited<ReturnType<typeof load>>["inspectNfseCandidate"];
before(async () => { inspect = (await load()).inspectNfseCandidate; });
const encode = (xml: string | Buffer) => gzipSync(xml).toString("base64");
const input = (xml = candidateXml(), patch: Record<string, unknown> = {}) => ({ expectedDpsXml: structuralSignedDps, nfseXmlGZipB64: encode(xml), expectedAccessKey: candidateKey, ...patch });
const safe = (code?: string) => (error: any) => { if (code) assert.equal(error.code, code); assert.equal(error.name, "NfseResponseError"); assert.equal(error.cause, undefined); assert.doesNotMatch(String(error) + JSON.stringify(error), /Cliente QA|private-marker|<NFSe|<DPS|11222333000181/); return true; };

test("RX01 estrutura/correlação não transformam assinatura falsa e cStat100 em autorização", () => {
  const result = inspect(input());
  assert.equal(result.state, "candidate_correlated"); assert.equal(result.structurallyValid, true); assert.equal(result.sourceMatches, true);
  assert.equal(result.dpsId, dpsId); assert.equal(result.candidateAccessKey, candidateKey); assert.equal(result.candidateNumber, "1");
  assert.equal(result.xmlSha256, createHash("sha256").update(candidateXml()).digest("hex"));
  for (const key of ["signatureVerified", "trustChainVerified", "contractConfirmed", "officialAuthorization", "readyForSubmission"] as const) assert.equal(result[key], false);
  for (const key of ["xml", "certificate", "customerName", "payload", "protocol"]) assert.equal(Object.hasOwn(result, key), false);
});

test("RX02 outra DPS/alteração de valor, cliente, serviço ou assinatura não pertencem à fonte", () => {
  for (const changed of [structuralSignedDps.replaceAll(dpsId, dpsId.slice(0,-1)+"2"), structuralSignedDps.replace("123.45", "123.46"), structuralSignedDps.replace("Cliente QA", "Outro QA"), structuralSignedDps.replace("Reparo genérico de QA", "Outro serviço QA"), structuralSignedDps.replace("<SignatureValue>AA==", "<SignatureValue>AQ==")])
    assert.throws(() => inspect(input(candidateXml(changed))), safe("NFSE_SOURCE_MISMATCH"));
});

test("RX03 chave esperada e emitente divergentes são rejeitados sem inferir dados pelo número", () => {
  assert.throws(() => inspect(input(undefined, { expectedAccessKey: "1".repeat(50) })), safe("NFSE_SOURCE_MISMATCH"));
  assert.throws(() => inspect(input(candidateXml().replace("<emit><CNPJ>11222333000181", "<emit><CNPJ>11444777000161"))), safe("NFSE_SOURCE_MISMATCH"));
  const { expectedAccessKey: _, ...withoutKey } = input(); assert.equal(inspect(withoutKey).candidateAccessKey, candidateKey);
});

test("RX04 canonicalização aceita ordem de atributos e namespace não usado sem alterar texto", () => {
  const changed = structuralSignedDps.replace('<DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01">', '<DPS versao="1.01" xmlns:unused="urn:qa" xmlns="http://www.sped.fazenda.gov.br/nfse">');
  assert.equal(inspect(input(candidateXml(changed))).sourceMatches, true);
  assert.throws(() => inspect(input(candidateXml(structuralSignedDps.replace("Cliente QA", "Cliente  QA")))), safe("NFSE_SOURCE_MISMATCH"));
});

test("RX05 assinatura ausente/extra, referência externa ou Object não são suportados", () => {
  const xml = candidateXml(), signature = structuralSignature("NFS" + candidateKey);
  for (const changed of [xml.replace(signature, ""), xml.replace("</NFSe>", signature+"</NFSe>"), xml.replace(`URI="#NFS${candidateKey}"`, 'URI="https://example.test/private-marker"'), xml.replace(signature, signature.replace("</Signature>", "<Object>private-marker</Object></Signature>"))])
    assert.throws(() => inspect(input(changed)), safe());
});

test("RX06 XML incompleto, fora do namespace/versão e campos inválidos não passam o XSD", () => {
  for (const changed of [candidateXml().replace("</NFSe>", ""), candidateXml().replace('xmlns="http://www.sped.fazenda.gov.br/nfse"', 'xmlns="urn:wrong"'), candidateXml().replace('versao="1.01"', 'versao="9.99"'), candidateXml().replace("<nNFSe>1</nNFSe>", ""), candidateXml().replace("<vLiq>123.45", "<vLiq>-1.00")])
    assert.throws(() => inspect(input(changed)), safe());
});

test("RX07 DTD, entidade, XInclude, schemaLocation e PI falham sem resolver recursos", () => {
  const body = candidateXml().replace(/<\?xml[^?]*\?>/, "");
  for (const changed of ['<!DOCTYPE NFSe SYSTEM "file:///private-marker">'+body, '<!DOCTYPE NFSe [<!ENTITY ext SYSTEM "https://example.test/private-marker">]>'+body.replace("Emitente genérico QA", "&ext;"), body.replace("</infNFSe>", '<xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="file:///private-marker"/></infNFSe>'), body.replace("<NFSe ", '<NFSe xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="urn:x https://example.test/private-marker" '), '<?process private-marker?>'+body])
    assert.throws(() => inspect(input(changed)), safe());
});

test("RX08 base64 inválido, comprimido inválido e UTF-8 inválido são recusados", () => {
  for (const nfseXmlGZipB64 of ["", "a", "!!!!", encode(candidateXml())+"\n", Buffer.from(candidateXml()).toString("base64"), Buffer.from([0x1f,0x8b,0x08,0xff]).toString("base64"), encode(Buffer.from([0xc3,0x28]))])
    assert.throws(() => inspect(input(undefined, { nfseXmlGZipB64 })), safe());
});

test("RX09 bomba de descompressão e payload excessivo são limitados", () => {
  assert.throws(() => inspect(input(undefined, { nfseXmlGZipB64: encode("x".repeat(512*1024+1)) })), safe());
  assert.throws(() => inspect(input(undefined, { nfseXmlGZipB64: "A".repeat(512*1024+4) })), safe());
});

test("RX10 entradas extras, fonte sem assinatura/produção e IDs repetidos são recusados", () => {
  for (const patch of [{ httpStatus: 200 }, { officialAuthorization: true }, { expectedDpsXml: unsignedDpsXml }, { expectedDpsXml: structuralSignedDps.replace("<tpAmb>2", "<tpAmb>1") }, { expectedAccessKey: "../wrong" }])
    assert.throws(() => inspect(input(undefined, patch)), safe());
  assert.throws(() => inspect(input(candidateXml().replace(`<infNFSe Id="NFS${candidateKey}"`, `<infNFSe Id="${dpsId}"`))), safe());
});

test("RX11 resolver compartilhado conserva validação DPS após NFS-e e em ordem alternada", async () => {
  const { validateUnsignedDpsXml, validateSignedDpsStructure } = process.env.SISTEM_QA_COMPILED_RESPONSE === "true"
    ? await import(new URL("../dist/nfse-dps-validation.js", import.meta.url).href) : await import("../src/nfse-dps-validation.ts");
  for (let round=0;round<3;round++) {
    assert.equal(validateUnsignedDpsXml(unsignedDpsXml).structurallyValid, true); inspect(input());
    assert.equal(validateSignedDpsStructure(structuralSignedDps).structurallyValid, true);
  }
});

test("RX12 base64 grande porém válido dentro do limite continua aceito", () => {
  const xml = candidateXml().replace("</NFSe>", `<!--${randomBytes(290*1024).toString("base64")}--></NFSe>`), payload = input(xml);
  assert.ok(payload.nfseXmlGZipB64.length > 300*1024 && payload.nfseXmlGZipB64.length < 512*1024);
  assert.equal(inspect(payload).sourceMatches, true);
});

test("RX13 teto descompactado aceita XML válido no limite e rejeita um byte a mais", () => {
  const base = candidateXml(), padding = 512*1024 - Buffer.byteLength(base) - 7;
  const atLimit = base.replace("</NFSe>", `<!--${"x".repeat(padding)}--></NFSe>`);
  assert.equal(Buffer.byteLength(atLimit), 512*1024); assert.equal(inspect(input(atLimit)).sourceMatches, true);
  assert.throws(() => inspect(input(atLimit.replace("</NFSe>", " </NFSe>"))), safe());
});

test("RX14 manifesto adulterado fecha os dois guards sem revelar corpo ou erro nativo", () => {
  const compiled = process.env.SISTEM_QA_COMPILED_RESPONSE === "true", directory = compiled ? "../dist/" : "../src/", extension = compiled ? ".js" : ".ts";
  const script = `import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';import {gzipSync} from 'node:zlib';
    const fixture=await import(${JSON.stringify(new URL("./nfse-response-fixture.ts", import.meta.url).href)});
    const response=await import(${JSON.stringify(new URL(directory+"nfse-response-validation"+extension, import.meta.url).href)});
    const dps=await import(${JSON.stringify(new URL(directory+"nfse-dps-validation"+extension, import.meta.url).href)});
    const original=fs.readFileSync;fs.readFileSync=(file,...args)=>String(file).endsWith('/manifest.json')?Buffer.from('altered'):original(file,...args);syncBuiltinESMExports();
    const codes={};try{response.inspectNfseCandidate({expectedDpsXml:fixture.structuralSignedDps,nfseXmlGZipB64:gzipSync(fixture.candidateXml()).toString('base64')});}catch(error){codes.response=error.code;}
    try{dps.validateSignedDpsStructure(fixture.structuralSignedDps);}catch(error){codes.dps=error.code;}
    process.stdout.write(JSON.stringify(codes));`;
  const output = execFileSync(process.execPath, ["--import", import.meta.resolve("tsx"), "--input-type=module", "--eval", script], { encoding: "utf8", windowsHide: true, timeout: 15000 });
  assert.deepEqual(JSON.parse(output), { response: "NFSE_SCHEMA_UNAVAILABLE", dps: "DPS_SCHEMA_UNAVAILABLE" });
});

test("RX15 alias de ID no KeyInfo não pode duplicar o identificador da nota ou da DPS", () => {
  const signature = structuralSignature("NFS"+candidateKey);
  for (const attribute of ["xml:id", "id", "ID", "Id"]) for (const target of ["NFS"+candidateKey, dpsId]) {
    const changedSignature = signature.replace("</KeyInfo>", `<x:aux xmlns:x="urn:qa" ${attribute}="${target}"/></KeyInfo>`);
    assert.throws(() => inspect(input(candidateXml().replace(signature, changedSignature))), safe());
  }
});

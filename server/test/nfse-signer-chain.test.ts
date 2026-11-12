import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createHash, X509Certificate } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { gzipSync } from "node:zlib";
import forge from "node-forge";
import { SignedXml } from "xml-crypto";
import { createA1Fixture } from "./nfse-a1-fixture.ts";
import { candidateXml, candidateKey, structuralSignature, structuralSignedDps } from "./nfse-response-fixture.ts";

const load = (): Promise<typeof import("../src/nfse-response-validation.ts")> => process.env.SISTEM_QA_COMPILED_RESPONSE === "true"
  ? import(new URL("../dist/nfse-response-validation.js", import.meta.url).href) : import("../src/nfse-response-validation.ts");
let service: Awaited<ReturnType<typeof load>>, fixture: Awaited<ReturnType<typeof createA1Fixture>>, directory: string;
type Issued = { pem: string; certificate: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey };
let root: Issued, intermediate: Issued, leaf: Issued, foreign: Issued;
const qaRoot = resolve(import.meta.dirname, "../.local/tests");
const c14n="http://www.w3.org/TR/2001/REC-xml-c14n-20010315", rsa="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256", digest="http://www.w3.org/2001/04/xmlenc#sha256", ds="http://www.w3.org/2000/09/xmldsig#";
let serial=1;

function issue(keyName: string, name: string, parent?: Issued, options: {ca?: boolean; pathLen?: number; certSign?: boolean; sign?: boolean; extensions?: any[]; sha1?: boolean} = {}): Issued {
  const certificate=forge.pki.createCertificate(), key=forge.pki.privateKeyFromPem(fixture.materials[keyName].keyPem);
  certificate.publicKey=forge.pki.certificateFromPem(fixture.materials[keyName].certificatePem).publicKey;
  certificate.serialNumber=(serial++).toString(16).padStart(2,"0");
  certificate.validity.notBefore=new Date(fixture.now.getTime()-60000);certificate.validity.notAfter=new Date(fixture.now.getTime()+86400000);
  certificate.setSubject([{name:"commonName",value:name},{name:"countryName",value:"BR"}]);
  certificate.setIssuer(parent?parent.certificate.subject.attributes:certificate.subject.attributes);
  const ca=options.ca===true;
  certificate.setExtensions([
    {name:"basicConstraints",critical:true,cA:ca,...(options.pathLen===undefined?{}:{pathLenConstraint:options.pathLen})},
    {name:"keyUsage",critical:true,digitalSignature:options.sign??!ca,nonRepudiation:!ca,keyCertSign:options.certSign??ca,cRLSign:ca},
    {name:"subjectKeyIdentifier"},
    {name:"authorityKeyIdentifier",keyIdentifier:(parent?.certificate??certificate).generateSubjectKeyIdentifier().getBytes()},
    ...(options.extensions??[]),
  ]);
  certificate.sign(parent?.key??key,options.sha1?forge.md.sha1.create():forge.md.sha256.create());
  return {pem:forge.pki.certificateToPem(certificate),certificate,key};
}
function signedXml(signer=leaf) {
  const sign=new SignedXml({privateKey:forge.pki.privateKeyToPem(signer.key),publicCert:signer.pem,signatureAlgorithm:rsa,canonicalizationAlgorithm:c14n});
  sign.addReference({xpath:"/*[local-name()='NFSe']/*[local-name()='infNFSe']",transforms:[ds+"enveloped-signature",c14n],digestAlgorithm:digest});
  sign.computeSignature(candidateXml().replace(structuralSignature("NFS"+candidateKey),""),{location:{reference:"/*[local-name()='NFSe']/*[local-name()='infNFSe']",action:"after"}});
  return sign.getSignedXml();
}
const payload=(signer=leaf)=>({expectedDpsXml:structuralSignedDps,nfseXmlGZipB64:gzipSync(signedXml(signer)).toString("base64"),expectedAccessKey:candidateKey,expectedSignerCertificatePem:signer.pem,at:fixture.now});
const policy=()=>({rootCertificatePem:root.pem,intermediateCertificatesPem:[intermediate.pem]});
const verify=(body:unknown,trust?:unknown)=>(service.verifyNfseCandidateSignature as any)(body,trust);
const safe=(error:any)=>{assert.equal(error.name,"NfseResponseError");assert.equal(error.code,"NFSE_CERTIFICATE_CHAIN_INVALID");assert.equal(error.cause,undefined);assert.doesNotMatch(String(error)+JSON.stringify(error),/BEGIN|PRIVATE KEY|<NFSe|<DPS|Generic Chain/);return true;};

before(async()=>{
  service=await load();fixture=await createA1Fixture(["ca","different","valid","wrongIdentity","weak"]);
  root=issue("ca","Generic Chain Root QA",undefined,{ca:true,pathLen:2});
  intermediate=issue("different","Generic Chain Intermediate QA",root,{ca:true,pathLen:0});
  leaf=issue("valid","Generic Chain Signer QA",intermediate);
  foreign=issue("wrongIdentity","Generic Chain Root QA",undefined,{ca:true,pathLen:2});
  await mkdir(qaRoot,{recursive:true});directory=await mkdtemp(join(qaRoot,"nfse-chain-"));
  await Promise.all([writeFile(join(directory,"root.pem"),root.pem),writeFile(join(directory,"intermediate.pem"),intermediate.pem),writeFile(join(directory,"leaf.pem"),leaf.pem)]);
});
after(async()=>{
  try { if(directory){const target=resolve(directory);if(!target.startsWith(qaRoot+sep+"nfse-chain-"))throw Error("Invalid QA chain path");await rm(target,{recursive:true,force:true});} }
  finally { await fixture?.close(); }
});

test("CA01 cadeia configurada válida concorda com OpenSSL, sem promover emissão/revogação",()=>{
  const openssl=process.env.SISTEM_TEST_OPENSSL??(process.platform==="win32"?"C:\\Program Files\\Git\\usr\\bin\\openssl.exe":"openssl");
  const output=execFileSync(openssl,["verify","-x509_strict","-CAfile",join(directory,"root.pem"),"-untrusted",join(directory,"intermediate.pem"),join(directory,"leaf.pem")],{encoding:"utf8",windowsHide:true,timeout:15000});
  assert.match(output,/OK/);
  const result=verify(payload(),policy());assert.equal(result.signatureVerified,true);assert.equal(result.trustChainVerified,true);assert.equal(result.chainLength,3);
  assert.equal(result.trustAnchorFingerprint256,createHash("sha256").update(new X509Certificate(root.pem).raw).digest("hex"));
  for(const field of ["officialProfileConfirmed","revocationChecked","contractConfirmed","officialAuthorization","readyForSubmission"])assert.equal(result[field],false);
  assert.equal(Object.hasOwn(result,"rootCertificatePem"),false);
});

test("CA02 contexto ausente mantém matemática separada; inválido não faz downgrade",()=>{
  assert.equal(verify(payload()).trustChainVerified,false);
  for(const trust of [null,{}, {rootCertificatePem:root.pem}, {...policy(),enabled:false}, {rootCertificatePem:"invalid",intermediateCertificatesPem:[]}])assert.throws(()=>verify(payload(),trust),safe);
  assert.throws(()=>verify({...payload(),rootCertificatePem:root.pem},policy()));
});

test("CA03 raiz de mesmo nome com outra chave não é aceita",()=>{
  assert.throws(()=>verify(payload(),{...policy(),rootCertificatePem:foreign.pem}),safe);
});

test("CA04 elo ausente, falso ou fora de ordem falha",()=>{
  const wrong=issue("wrongIdentity","Generic Chain Intermediate QA",root,{ca:true,pathLen:0});
  for(const intermediates of [[],[wrong.pem],[root.pem,intermediate.pem]])assert.throws(()=>verify(payload(),{...policy(),intermediateCertificatesPem:intermediates}),safe);
});

test("CA05 duplicados, excesso, PEM composto e callbacks não entram na política",()=>{
  for(const trust of [{...policy(),intermediateCertificatesPem:[intermediate.pem,intermediate.pem]}, {...policy(),intermediateCertificatesPem:Array(5).fill(intermediate.pem)}, {...policy(),rootCertificatePem:root.pem+foreign.pem}, {...policy(),verify:()=>true}, {...policy(),rootCertificatePem:"x".repeat(65537)}])assert.throws(()=>verify(payload(),trust),safe);
});

test("CA06 autoridade sem cA ou keyCertSign não pode emitir folha aceita",()=>{
  for(const options of [{ca:false},{ca:true,certSign:false}]) {
    const bad=issue("different","Generic Chain Intermediate QA",root,options), child=issue("valid","Generic Chain Signer QA",bad);
    assert.throws(()=>verify(payload(child),{...policy(),intermediateCertificatesPem:[bad.pem]}),safe);
  }
});

test("CA07 restrição de profundidade é aplicada até a raiz",()=>{
  const shallow=issue("ca","Generic Chain Root QA",undefined,{ca:true,pathLen:0});
  const middle=issue("different","Generic Chain Intermediate QA",shallow,{ca:true,pathLen:0}),child=issue("valid","Generic Chain Signer QA",middle);
  assert.throws(()=>verify(payload(child),{rootCertificatePem:shallow.pem,intermediateCertificatesPem:[middle.pem]}),safe);
});

test("CA08 períodos de raiz/intermediária são conferidos no instante explícito",()=>{
  const expired=issue("different","Generic Chain Intermediate QA",root,{ca:true,pathLen:0});
  expired.certificate.validity.notAfter=new Date(fixture.now.getTime()-1000);expired.certificate.sign(root.key,forge.md.sha256.create());expired.pem=forge.pki.certificateToPem(expired.certificate);
  const child=issue("valid","Generic Chain Signer QA",expired);
  assert.throws(()=>verify(payload(child),{...policy(),intermediateCertificatesPem:[expired.pem]}),safe);
  const expiredRoot=issue("ca","Generic Chain Root QA",undefined,{ca:true,pathLen:2});
  expiredRoot.certificate.validity.notAfter=new Date(fixture.now.getTime()-1000);expiredRoot.certificate.sign(expiredRoot.key,forge.md.sha256.create());expiredRoot.pem=forge.pki.certificateToPem(expiredRoot.certificate);
  const middle=issue("different","Generic Chain Intermediate QA",expiredRoot,{ca:true,pathLen:0}),rootChild=issue("valid","Generic Chain Signer QA",middle);
  assert.throws(()=>verify(payload(rootChild),{rootCertificatePem:expiredRoot.pem,intermediateCertificatesPem:[middle.pem]}),safe);
});

test("CA09 SHA1 e autoridade fraca não são promovidas por pertencer à cadeia",()=>{
  for(const middle of [issue("different","Generic Chain Intermediate QA",root,{ca:true,sha1:true}),issue("weak","Generic Chain Intermediate QA",root,{ca:true})]) {
    const child=issue("valid","Generic Chain Signer QA",middle);
    assert.throws(()=>verify(payload(child),{...policy(),intermediateCertificatesPem:[middle.pem]}),safe);
  }
});

test("CA10 extensão de restrição não suportada é recusada mesmo não crítica",()=>{
  const restriction={id:"2.5.29.30",critical:false,value:forge.asn1.toDer(forge.asn1.create(forge.asn1.Class.UNIVERSAL,forge.asn1.Type.SEQUENCE,true,[])).getBytes()};
  const middle=issue("different","Generic Chain Intermediate QA",root,{ca:true,extensions:[restriction]}),child=issue("valid","Generic Chain Signer QA",middle);
  assert.throws(()=>verify(payload(child),{...policy(),intermediateCertificatesPem:[middle.pem]}),safe);
});

test("CA11 raiz não autoassinada ou folha sem digitalSignature não é aceita",()=>{
  const cross=issue("ca","Generic Chain Root QA",foreign,{ca:true,pathLen:2}),middle=issue("different","Generic Chain Intermediate QA",cross,{ca:true}),child=issue("valid","Generic Chain Signer QA",middle);
  assert.throws(()=>verify(payload(child),{rootCertificatePem:cross.pem,intermediateCertificatesPem:[middle.pem]}),safe);
  const noUsage=issue("valid","Generic Chain Signer QA",intermediate,{sign:false});
  assert.throws(()=>verify(payload(noUsage),policy()),safe);
});

test("CA12 cadeia direta folha→raiz também é validada sem buscar intermediária externa",()=>{
  const direct=issue("valid","Generic Chain Direct QA",root);
  const result=verify(payload(direct),{rootCertificatePem:root.pem,intermediateCertificatesPem:[]});
  assert.equal(result.trustChainVerified,true);assert.equal(result.chainLength,2);assert.equal(result.officialAuthorization,false);
});

test("CA13 extensão crítica desconhecida não pode ser ignorada por callback",()=>{
  const extension={id:"1.2.3.4",critical:true,value:forge.asn1.toDer(forge.asn1.create(forge.asn1.Class.UNIVERSAL,forge.asn1.Type.UTF8,false,"QA")).getBytes()};
  const middle=issue("different","Generic Chain Intermediate QA",root,{ca:true,extensions:[extension]}),child=issue("valid","Generic Chain Signer QA",middle);
  assert.throws(()=>verify(payload(child),{...policy(),intermediateCertificatesPem:[middle.pem]}),safe);
});

test("CA14 certificado parseável acima do teto de PEM também é recusado",()=>{
  const extension={id:"1.2.3.4",critical:false,value:forge.asn1.toDer(forge.asn1.create(forge.asn1.Class.UNIVERSAL,forge.asn1.Type.OCTETSTRING,false,"x".repeat(70*1024))).getBytes()};
  const oversizedRoot=issue("ca","Generic Chain Root QA",undefined,{ca:true,pathLen:2,extensions:[extension]});
  assert.ok(Buffer.byteLength(oversizedRoot.pem)>65536);assert.ok(new X509Certificate(oversizedRoot.pem).raw.length>65536);
  const middle=issue("different","Generic Chain Intermediate QA",oversizedRoot,{ca:true,pathLen:0}),child=issue("valid","Generic Chain Signer QA",middle);
  assert.throws(()=>verify(payload(child),{rootCertificatePem:oversizedRoot.pem,intermediateCertificatesPem:[middle.pem]}),safe);
});

test("CA15 extensões de autoridade duplicadas e conflitantes não escolhem primeira ocorrência",()=>{
  for(const extension of [{name:"basicConstraints",critical:true,cA:false},{name:"keyUsage",critical:true,digitalSignature:true,keyCertSign:false}]) {
    const middle=issue("different","Generic Chain Intermediate QA",root,{ca:true,extensions:[extension]}),child=issue("valid","Generic Chain Signer QA",middle);
    assert.throws(()=>verify(payload(child),{...policy(),intermediateCertificatesPem:[middle.pem]}),safe);
  }
});

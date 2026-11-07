import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createHash, X509Certificate, verify, sign as nodeSign } from "node:crypto";
import forge from "node-forge";
import { SignedXml } from "xml-crypto";
import { XmlDocument } from "libxml2-wasm";
import { unsignedDpsXml, dpsId } from "./nfse-dps-fixture.ts";
import { createA1Fixture } from "./nfse-a1-fixture.ts";

// Expectations fixed before implementation. All certificates/keys are isolated generic QA.
const profile="experimental-rsa-sha256-c14n-v1",cnpj="11222333000181",ns="http://www.sped.fazenda.gov.br/nfse",ds="http://www.w3.org/2000/09/xmldsig#";
const rsa="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",hash="http://www.w3.org/2001/04/xmlenc#sha256",c14n="http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
let now: Date, passphrase: string, certificateFixture: Awaited<ReturnType<typeof createA1Fixture>>;
let materials: Awaited<ReturnType<typeof createA1Fixture>>["materials"] = {};
before(async () => {
 certificateFixture = await createA1Fixture();
 ({materials, passphrase, now} = certificateFixture);
});
after(async () => { await certificateFixture?.close(); });
const load=()=>import("../src/nfse-dps-signature.ts");
function input(name="valid"){return {xml:unsignedDpsXml,credentials:{pfx:materials[name].pfx,passphrase},issuerCnpj:cnpj,at:now,profile};}
function verification(xml:string,name="valid"){return {xml,certificatePem:materials[name].certificatePem,issuerCnpj:cnpj,at:now,profile};}
function safe(error:any,code?:string){if(code)assert.equal(error.code,code);assert.equal(typeof error.code,"string");assert.equal(error.cause,undefined);assert.doesNotMatch(String(error),/BEGIN|PRIVATE KEY|<DPS|11222333000181/);assert.ok(!JSON.stringify(error).includes(passphrase));return true;}
function reference(xml=unsignedDpsXml){return xml.match(/<infDPS\b[\s\S]*<\/infDPS>/)![0];}

test("NFSDS01 known C14N vector is independent from the signer",()=>{
 const doc=XmlDocument.fromString('<DPS xmlns="urn:qa"><infDPS z="2" a="1"><value>1 &amp; 2</value><empty/></infDPS></DPS>');
 try{assert.equal(doc.get("/*/*")!.canonicalizeToString(),'<infDPS xmlns="urn:qa" a="1" z="2"><value>1 &amp; 2</value><empty></empty></infDPS>');}finally{doc.dispose();}
});
test("NFSDS02 explicit experimental profile signs and verifies without changing infDPS or claiming official acceptance",async()=>{
 const {signDpsOffline,verifyDpsOffline}=await load(),before=Buffer.from(materials.valid.pfx);const result=signDpsOffline(input());
 assert.equal(result.state,"signed_offline");assert.equal(result.profile,profile);assert.equal(result.readyForSubmission,false);assert.equal(result.officialProfileConfirmed,false);assert.equal(result.trustChainVerified,false);assert.equal(result.revocationChecked,false);
 assert.equal(result.cryptographicSignatureValid,true);assert.equal(result.structurallyValid,true);assert.equal(result.id,dpsId);assert.equal(reference(result.xml),reference());assert.deepEqual(materials.valid.pfx,before);
 assert.ok(result.pendingChecks.includes("OFFICIAL_SIGNATURE_PROFILE_UNCONFIRMED"));assert.ok(result.pendingChecks.includes("ICP_BRASIL_CHAIN_UNVERIFIED"));assert.ok(result.pendingChecks.includes("CERTIFICATE_REVOCATION_UNVERIFIED"));
 assert.ok(!JSON.stringify(result).includes(passphrase));assert.doesNotMatch(result.xml,/PRIVATE KEY|BEGIN CERTIFICATE/);
 const verified=verifyDpsOffline(verification(result.xml));assert.equal(verified.id,dpsId);assert.equal(verified.cryptographicSignatureValid,true);assert.match(verified.verifiedInfDpsXml,/<infDPS/);assert.equal(verified.readyForSubmission,false);
});
test("NFSDS03 independent digest, Node RSA verification and xml-crypto verifier agree",async()=>{
 const {signDpsOffline}=await load(),signed=signDpsOffline(input()).xml;
 const canonicalReference=reference().replace('<infDPS Id=',`<infDPS xmlns="${ns}" Id=`);
 assert.equal(signed.match(/<DigestValue>([^<]+)<\/DigestValue>/)![1],createHash("sha256").update(canonicalReference).digest("base64"));
 const signedInfo=signed.match(/<SignedInfo>[\s\S]*?<\/SignedInfo>/)![0].replace('<SignedInfo>',`<SignedInfo xmlns="${ds}">`).replace(/<([A-Za-z]+)([^>]*?)\/>/g,'<$1$2></$1>');
 assert.equal(verify("RSA-SHA256",Buffer.from(signedInfo),new X509Certificate(materials.valid.certificatePem).publicKey,Buffer.from(signed.match(/<SignatureValue>([^<]+)<\/SignatureValue>/)![1],"base64")),true);
 const checker=new SignedXml({publicCert:materials.valid.certificatePem,getCertFromKeyInfo:()=>null});checker.loadSignature(signed.match(/<Signature\b[\s\S]*<\/Signature>/)![0]);assert.equal(checker.checkSignature(signed),true);assert.deepEqual(checker.getSignedReferences(),[canonicalReference]);
});
test("NFSDS04 profile required, no caller algorithm override, credentials missing/invalid/wrong password/oversized are sanitized",async()=>{
 const {signDpsOffline}=await load();for(const patch of [{profile:undefined},{profile:"official"},{signatureAlgorithm:rsa}])assert.throws(()=>signDpsOffline({...input(),...patch} as any),e=>safe(e));
 for(const credentials of [undefined,{pfx:Buffer.alloc(0),passphrase},{pfx:Buffer.from("generic-invalid-pfx"),passphrase},{pfx:materials.valid.pfx,passphrase:"wrong-generic-password"},{pfx:Buffer.alloc(1024*1024+1),passphrase}])assert.throws(()=>signDpsOffline({...input(),credentials} as any),e=>safe(e));
});
test("NFSDS05 certificate identity is extracted from OtherName, never CN or declared issuer alone",async()=>{
 const {signDpsOffline}=await load();assert.throws(()=>signDpsOffline(input("noIdentity")),e=>safe(e,"CERTIFICATE_IDENTITY_REQUIRED"));assert.throws(()=>signDpsOffline(input("wrongIdentity")),e=>safe(e,"CERTIFICATE_IDENTITY_MISMATCH"));assert.throws(()=>signDpsOffline({...input(),issuerCnpj:"11444777000161"}),e=>safe(e,"DPS_SIGNER_IDENTITY_MISMATCH"));
});
test("NFSDS06 expired/not-yet-valid, CA, missing non-repudiation and weak RSA certificates are rejected",async()=>{
 const {signDpsOffline}=await load(),cert=new X509Certificate(materials.valid.certificatePem);
 for(const at of [new Date(Date.parse(cert.validFrom)-1000),new Date(Date.parse(cert.validTo)+1000),new Date(NaN)])assert.throws(()=>signDpsOffline({...input(),at}),e=>safe(e));
 for(const name of ["ca","usage","weak"])assert.throws(()=>signDpsOffline(input(name)),e=>safe(e));
});
test("NFSDS07 PFX without private key, mismatched key and duplicate leaf are not accepted",async()=>{
 const {signDpsOffline}=await load(),cert=forge.pki.certificateFromPem(materials.valid.certificatePem),key=forge.pki.privateKeyFromPem(materials.valid.keyPem),other=forge.pki.privateKeyFromPem(materials.different.keyPem);
 for(const [privateKey,certificates]of [[null,[cert]],[other,[cert]],[key,[cert,cert]]] as const){const pfx=Buffer.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(privateKey as any,[...certificates],passphrase,{algorithm:"aes256",count:2048})).getBytes(),"binary");try{assert.throws(()=>signDpsOffline({...input(),credentials:{pfx,passphrase}}),e=>safe(e));}finally{pfx.fill(0);}}
});
test("NFSDS08 tampering signed values, identifiers and signature bytes never verifies",async()=>{
 const {signDpsOffline,verifyDpsOffline}=await load(),xml=signDpsOffline(input()).xml;
 for(const changed of [xml.replace("123.45","123.46"),xml.replace('Id="'+dpsId+'"','Id="'+dpsId.slice(0,-1)+'2"'),xml.replace(/(<SignatureValue>)[A-Za-z0-9+]/,'$1!'),xml.replace("<tpAmb>2</tpAmb>","<tpAmb>1</tpAmb>"),xml.replace('versao="1.01"','versao="1.00"')])assert.throws(()=>verifyDpsOffline(verification(changed)),e=>safe(e));
});
test("NFSDS09 reference must be one literal local infDPS ID, never empty/external/XPointer/different",async()=>{
 const {signDpsOffline,verifyDpsOffline}=await load(),xml=signDpsOffline(input()).xml;
 for(const uri of ["","https://example.invalid/dps","file:///generic/forbidden","#xpointer(/)","#another"]){const changed=xml.replace('URI="#'+dpsId+'"',`URI="${uri}"`);assert.throws(()=>verifyDpsOffline(verification(changed)),e=>safe(e));}
 const ref=xml.match(/<Reference\b[\s\S]*?<\/Reference>/)![0];assert.throws(()=>verifyDpsOffline(verification(xml.replace(ref,ref+ref))),e=>safe(e));
});
test("NFSDS10 wrapping, Object, duplicated IDs and xml:id aliases are rejected",async()=>{
 const {signDpsOffline,verifyDpsOffline}=await load(),xml=signDpsOffline(input()).xml;
 for(const changed of [xml.replace('</Signature>',`<Object>${reference()}</Object></Signature>`),xml.replace('</DPS>',reference()+'</DPS>'),xml.replace('<Signature xmlns=',`<Signature Id="${dpsId}" xmlns=`),xml.replace('<Signature xmlns=',`<Signature xml:id="${dpsId}" xmlns=`),xml.replace('</DPS>',xml.match(/<Signature\b[\s\S]*<\/Signature>/)![0]+'</DPS>')])assert.throws(()=>verifyDpsOffline(verification(changed)),e=>safe(e));
});
test("NFSDS11 algorithm downgrades, extra transforms and KeyInfo retrieval/key substitution are rejected",async()=>{
 const {signDpsOffline,verifyDpsOffline}=await load(),xml=signDpsOffline(input()).xml;
 for(const changed of [xml.replace(rsa,ds+"rsa-sha1"),xml.replace(hash,ds+"sha1"),xml.replace(c14n,c14n+"#WithComments"),xml.replace('</Transforms>',`<Transform Algorithm="http://www.w3.org/TR/1999/REC-xslt-19991116"/></Transforms>`),xml.replace('<X509Data>','<RetrievalMethod URI="https://example.invalid/key"/><X509Data>'),xml.replace('<X509Data>','<KeyValue/><X509Data>')])assert.throws(()=>verifyDpsOffline(verification(changed)),e=>safe(e));
});
test("NFSDS12 expected certificate is pinned independently from embedded KeyInfo",async()=>{
 const {signDpsOffline,verifyDpsOffline}=await load(),xml=signDpsOffline(input()).xml;
 assert.throws(()=>verifyDpsOffline(verification(xml,"different")),e=>safe(e));
 const other=new X509Certificate(materials.different.certificatePem).raw.toString("base64");assert.throws(()=>verifyDpsOffline(verification(xml.replace(/<X509Certificate>[^<]+<\/X509Certificate>/,`<X509Certificate>${other}</X509Certificate>`))),e=>safe(e));
 assert.throws(()=>verifyDpsOffline({...verification(xml),certificatePem:undefined} as any),e=>safe(e));
});
test("NFSDS13 XML resources/DTD/PI/comments are refused and unsigned validation remains strict",async()=>{
 const {signDpsOffline,verifyDpsOffline}=await load(),xml=signDpsOffline(input()).xml;
 for(const changed of [xml.replace('<DPS ','<!DOCTYPE DPS [<!ENTITY x SYSTEM "https://example.invalid/entity">]><DPS '),xml.replace('</DPS>','<?other data?></DPS>'),xml.replace('</DPS>','<!-- untrusted comment --></DPS>'),xml.replace('</DPS>','<xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="https://example.invalid/entity"/></DPS>')," ".repeat(170*1024)])assert.throws(()=>verifyDpsOffline(verification(changed)),e=>safe(e));
 const {validateUnsignedDpsXml}=await import("../src/nfse-dps-validation.ts");assert.throws(()=>validateUnsignedDpsXml(xml),e=>safe(e,"SIGNED_DPS_NOT_SUPPORTED"));assert.throws(()=>signDpsOffline({...input(),xml}),e=>safe(e));
});
test("NFSDS14 namespace context is included by C14N and verified by another implementation",async()=>{
 const {signDpsOffline,verifyDpsOffline}=await load(),xml=unsignedDpsXml.replace('<DPS xmlns=', '<DPS xmlns:context="urn:generic:context" xmlns=');const result=signDpsOffline({...input(),xml});assert.equal(verifyDpsOffline(verification(result.xml)).cryptographicSignatureValid,true);
 const checker=new SignedXml({publicCert:materials.valid.certificatePem,getCertFromKeyInfo:()=>null});checker.loadSignature(result.xml.match(/<Signature\b[\s\S]*<\/Signature>/)![0]);assert.equal(checker.checkSignature(result.xml),true);assert.throws(()=>verifyDpsOffline(verification(result.xml.replace('urn:generic:context','urn:generic:changed'))),e=>safe(e));
});
test("NFSDS15 visible PFX work parameters require a positive INTEGER within the local cap",async()=>{
 const {signDpsOffline}=await load();
 for(const invalid of [forge.asn1.create(forge.asn1.Class.UNIVERSAL,forge.asn1.Type.INTEGER,false,forge.asn1.integerToDer(100001).getBytes()),forge.asn1.create(forge.asn1.Class.UNIVERSAL,forge.asn1.Type.INTEGER,false,forge.asn1.integerToDer(-1).getBytes()),forge.asn1.create(forge.asn1.Class.UNIVERSAL,forge.asn1.Type.OCTETSTRING,false,"\x01")]){
  const parsed=forge.asn1.fromDer(materials.valid.pfx.toString("binary")),rootNodes=parsed.value as forge.asn1.Asn1[],mac=rootNodes[2].value as forge.asn1.Asn1[];mac[2]=invalid;const pfx=Buffer.from(forge.asn1.toDer(parsed).getBytes(),"binary");
  try{assert.throws(()=>signDpsOffline({...input(),credentials:{pfx,passphrase}}),e=>safe(e,"PFX_WORK_LIMIT_EXCEEDED"));}finally{pfx.fill(0);}
 }
});
test("NFSDS16 mathematically valid extra algorithm parameters are outside the fixed profile",async()=>{
 const {signDpsOffline,verifyDpsOffline}=await load(),signed=signDpsOffline(input()).xml;
 let changed=signed.replace(`<CanonicalizationMethod Algorithm="${c14n}"/>`,`<CanonicalizationMethod Algorithm="${c14n}"><Transform Algorithm="${c14n}"/></CanonicalizationMethod>`);
 const doc=XmlDocument.fromString(changed);let signature:string;try{const info=doc.get("/*/d:Signature/d:SignedInfo",{d:ds})!;signature=nodeSign("RSA-SHA256",Buffer.from(info.canonicalizeToString()),materials.valid.keyPem).toString("base64");}finally{doc.dispose();}
 changed=changed.replace(/<SignatureValue>[^<]+<\/SignatureValue>/,`<SignatureValue>${signature}</SignatureValue>`);
 const oracle=new SignedXml({publicCert:materials.valid.certificatePem,getCertFromKeyInfo:()=>null});oracle.loadSignature(changed.match(/<Signature\b[\s\S]*<\/Signature>/)![0]);assert.equal(oracle.checkSignature(changed),true,"fixture must remain mathematically valid");
 assert.throws(()=>verifyDpsOffline(verification(changed)),e=>safe(e,"INVALID_SIGNATURE_PROFILE"));
});

test("NFSI07 real isolated signer preserves the signed XML contract and caller credentials", async () => {
 const { signDpsIsolated } = await import("../src/nfse-dps-isolation.ts");
 const { verifyDpsOffline } = await load();
 const data = input(), before = Buffer.from(data.credentials.pfx);
 const result = await signDpsIsolated(data);
 assert.equal(result.state, "signed_offline");
 assert.equal(result.readyForSubmission, false);
 assert.equal(result.officialProfileConfirmed, false);
 assert.equal(result.trustChainVerified, false);
 assert.equal(result.revocationChecked, false);
 assert.equal(result.executionIsolated, true);
 assert.equal(result.verifiedInfDpsXml, verifyDpsOffline(verification(result.xml)).verifiedInfDpsXml);
 assert.equal(reference(result.xml), reference());
 assert.deepEqual(data.credentials.pfx, before);
 assert.ok(!JSON.stringify(result).includes(passphrase));
});

test("NFSI08 invalid PFX/password fail in the real child without leaking diagnostics", async () => {
 const { signDpsIsolated } = await import("../src/nfse-dps-isolation.ts");
 for (const credentials of [
  { pfx: Buffer.from("generic-invalid-pfx"), passphrase },
  { pfx: materials.valid.pfx, passphrase: "wrong-generic-password" },
 ]) await assert.rejects(signDpsIsolated({ ...input(), credentials }), error => safe(error, "SIGNING_FAILED"));
});

test("A1I01 inspection validates a certificate without generating DPS or exposing private material", async () => {
 const { inspectA1Offline } = await load();
 const { credentials, issuerCnpj, at } = input();
 const result = inspectA1Offline({ credentials, issuerCnpj, at });
 const cert = new X509Certificate(materials.valid.certificatePem);
 assert.equal(result.issuerCnpj, cnpj);
 assert.equal(result.certificateFingerprint256, createHash("sha256").update(cert.raw).digest("hex"));
 assert.equal(result.validFrom, new Date(cert.validFrom).toISOString());
 assert.equal(result.validTo, new Date(cert.validTo).toISOString());
 assert.equal(result.keyBits, 2048);
 for (const field of ["readyForSubmission", "trustChainVerified", "revocationChecked", "officialProfileConfirmed"] as const) assert.equal(result[field], false);
 assert.equal("xml" in result, false);
 assert.ok(!JSON.stringify(result).includes(passphrase));
 assert.doesNotMatch(JSON.stringify(result), /PRIVATE KEY|pfx|passphrase|certificatePem/);
});

test("A1I02 isolated inspection rejects identity, validity, usages, weak keys and bad password", async () => {
 const { inspectA1Isolated } = await import("../src/nfse-dps-isolation.ts");
 for (const name of ["noIdentity", "wrongIdentity", "ca", "usage", "weak"]) {
  const { credentials, issuerCnpj, at } = input(name);
  await assert.rejects(inspectA1Isolated({ credentials, issuerCnpj, at }), error => safe(error, "SIGNING_FAILED"));
 }
 const { credentials, issuerCnpj } = input();
 await assert.rejects(inspectA1Isolated({ credentials, issuerCnpj, at: new Date("2000-01-01") }), error => safe(error, "SIGNING_FAILED"));
 await assert.rejects(inspectA1Isolated({ credentials: { ...credentials, passphrase: "wrong" }, issuerCnpj, at: now }), error => safe(error, "SIGNING_FAILED"));
});

test("A1I03 isolated inspection snapshots credentials/date and returns metadata only", async () => {
 const { inspectA1Isolated } = await import("../src/nfse-dps-isolation.ts");
 const pfx = Buffer.from(materials.valid.pfx), at = new Date(now);
 try {
  const task = inspectA1Isolated({ credentials: { pfx, passphrase }, issuerCnpj: cnpj, at });
  pfx.fill(0); at.setFullYear(2000);
  const result = await task;
  assert.equal(result.issuerCnpj, cnpj);
  assert.equal(result.executionIsolated, true);
  assert.equal(result.readyForSubmission, false);
  assert.equal("xml" in result, false);
  assert.ok(!JSON.stringify(result).includes(passphrase));
 } finally { pfx.fill(0); }
});

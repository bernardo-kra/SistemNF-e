import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createServer, type request, type RequestOptions } from "node:https";
import type { AddressInfo } from "node:net";
import type { IncomingMessage, ClientRequest } from "node:http";

// NFSD: expectativas anteriores ao cliente. Somente certificado genérico e rede controlada.
const root = resolve(import.meta.dirname, "../.local/tests");
let directory = "", pfx: Buffer, certOnly: Buffer;
const passphrase = randomBytes(32).toString("base64url");
before(async () => {
  await mkdir(root, { recursive: true }); directory = await mkdtemp(join(root, "nfse-read-"));
  const run = promisify(execFile), openssl = process.env.SISTEM_TEST_OPENSSL ?? (process.platform === "win32" ? "C:\\Program Files\\Git\\usr\\bin\\openssl.exe" : "openssl");
  const key = join(directory, "qa-key.pem"), cert = join(directory, "qa-cert.pem");
  const env = { ...process.env, SISTEM_NFSD_QA_PASSWORD: passphrase };
  const options = { windowsHide: true, timeout: 15000, env };
  await run(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=Sistem QA Only", "-addext", "extendedKeyUsage=clientAuth,serverAuth", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], options);
  for (const onlyCertificate of [false, true]) {
    const file = join(directory, onlyCertificate ? "qa-cert-only.pfx" : "qa-client.pfx");
    await run(openssl, ["pkcs12", "-export", "-in", cert, ...(onlyCertificate ? ["-nokeys"] : ["-inkey", key]), "-out", file, "-passout", "env:SISTEM_NFSD_QA_PASSWORD"], options);
    if (onlyCertificate) certOnly = await readFile(file); else pfx = await readFile(file);
  }
});
after(async () => {
  pfx?.fill(0); certOnly?.fill(0);
  if (directory) {
    const target = resolve(directory);
    if (!target.startsWith(root + "/nfse-read-") && !target.startsWith(root + "\\nfse-read-")) throw new Error("Diretório de fixture inesperado");
    await rm(target, { recursive: true, force: true });
  }
});
const load = () => import("../src/nfse-national-read-client.ts");
type Reply = { status?: number; body?: unknown; raw?: Buffer; contentType?: string; complete?: boolean; hang?: boolean } | Error;
function mocked(reply: Reply) {
  const calls: { url: URL; options: RequestOptions; request: ClientRequest }[] = [];
  const requester = ((url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    const req = new EventEmitter() as ClientRequest;
    req.destroy = ((error?: Error) => { queueMicrotask(() => req.emit("error", error ?? new Error("qa-destroy"))); return req; }) as ClientRequest["destroy"];
    req.end = (() => {
      queueMicrotask(() => {
        if (reply instanceof Error) { req.emit("error", reply); return; }
        if (reply.hang) return;
        const stream = new PassThrough();
        const response = Object.assign(stream, { statusCode: reply.status ?? 200, headers: { "content-type": reply.contentType ?? "application/json" }, complete: reply.complete ?? true }) as unknown as IncomingMessage;
        callback(response);
        stream.end(reply.raw ?? Buffer.from(JSON.stringify(Object.hasOwn(reply, "body") ? reply.body : { conveniado: false })));
      }); return req;
    }) as ClientRequest["end"];
    calls.push({ url, options, request: req }); return req;
  }) as typeof request;
  return { calls, requester };
}
function safe(error: any, code: string) {
  assert.equal(error.code, code); assert.equal(error.cause, undefined); assert.equal(error.detail, undefined);
  assert.ok(!JSON.stringify(error).includes(passphrase)); assert.ok(!String(error).includes(passphrase)); return true;
}

test("NFSD01 certificado ausente, inválido, sem chave privada ou senha incorreta bloqueiam antes da rede", async () => {
  const { NfseNationalReadClient } = await load(), mock = mocked({});
  for (const credentials of [undefined, { pfx: Buffer.alloc(0), passphrase }]) assert.throws(() => new NfseNationalReadClient(credentials as any, { requester: mock.requester }), e => safe(e, "CERTIFICATE_REQUIRED"));
  for (const credentials of [{ pfx: Buffer.from("qa-invalid-pfx"), passphrase }, { pfx, passphrase: "wrong-qa-password" }, { pfx: certOnly, passphrase }]) assert.throws(() => new NfseNationalReadClient(credentials, { requester: mock.requester }), e => safe(e, "INVALID_CERTIFICATE"));
  assert.equal(mock.calls.length, 0);
});

test("NFSD02 consulta usa exclusivamente host/path oficiais restritos, GET, mTLS e verificação TLS", async () => {
  const { NfseNationalReadClient } = await load(), mock = mocked({ body: { conveniado: false } });
  const client = new NfseNationalReadClient({ pfx, passphrase }, { requester: mock.requester });
  try {
    assert.deepEqual(await client.getMunicipalAgreement("3550308"), { conveniado: false });
    const call = mock.calls[0]; assert.equal(String(call.url), "https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional/parametros_municipais/3550308/convenio");
    assert.equal(call.options.method, "GET"); assert.equal(call.options.rejectUnauthorized, true); assert.equal(call.options.minVersion, "TLSv1.2");
    assert.equal((call.options.agent as any).options.rejectUnauthorized, true); assert.ok((call.options.agent as any).options.secureContext);
    assert.deepEqual(call.options.headers, { Accept: "application/json", "Cache-Control": "no-store" });
    assert.ok(!JSON.stringify(client).includes(passphrase)); assert.ok(!JSON.stringify(client).includes(pfx.toString("base64")));
  } finally { client.close(); }
});

test("NFSD03 município malformado não vira URL e opções não liberam produção, host ou TLS inseguro", async () => {
  const { NfseNationalReadClient } = await load(), mock = mocked({});
  const client = new NfseNationalReadClient({ pfx, passphrase }, { requester: mock.requester });
  try { for (const code of ["", "../3550308", "3550308?x=1", "355030", "https://example.test", 3550308]) await assert.rejects(client.getMunicipalAgreement(code as any), e => safe(e, "INVALID_MUNICIPALITY")); }
  finally { client.close(); }
  for (const options of [{ environment: "production" }, { baseUrl: "https://example.test" }, { rejectUnauthorized: false }, { timeoutMs: 0 }, { timeoutMs: 60001 }]) assert.throws(() => new NfseNationalReadClient({ pfx, passphrase }, options as any), e => safe(e, "INVALID_CONFIGURATION"));
  assert.equal(mock.calls.length, 0);
});

test("NFSD04 redirects e rejeições não seguem destino nem repetem e não expõem corpo fiscal", async () => {
  const { NfseNationalReadClient } = await load();
  for (const status of [301, 302, 307, 308, 400, 401, 403, 404, 429, 500]) {
    const mock = mocked({ status, body: { private: passphrase } }), client = new NfseNationalReadClient({ pfx, passphrase }, { requester: mock.requester });
    try { await assert.rejects(client.getMunicipalAgreement("3550308"), e => safe(e, "OFFICIAL_SERVICE_REJECTED")); assert.equal(mock.calls.length, 1); }
    finally { client.close(); }
  }
});

test("NFSD05 erros de conexão ou TLS ficam sanitizados e não causam retry", async () => {
  const { NfseNationalReadClient } = await load(), mock = mocked(Object.assign(new Error(passphrase), { detail: passphrase }));
  const client = new NfseNationalReadClient({ pfx, passphrase }, { requester: mock.requester });
  try { await assert.rejects(client.getMunicipalAgreement("3550308"), e => safe(e, "OFFICIAL_SERVICE_UNAVAILABLE")); assert.equal(mock.calls.length, 1); }
  finally { client.close(); }
});

test("NFSD06 resposta incompleta, JSON inválido, tipo inesperado, UTF-8 inválido e excesso são recusados", async () => {
  const { NfseNationalReadClient } = await load();
  for (const reply of [{ complete: false }, { raw: Buffer.from("not-json") }, { body: [] }, { body: null }, { raw: Buffer.from([0xff]) }, { contentType: "text/html" }]) {
    const mock = mocked(reply), client = new NfseNationalReadClient({ pfx, passphrase }, { requester: mock.requester });
    try { await assert.rejects(client.getMunicipalAgreement("3550308"), e => safe(e, "INVALID_OFFICIAL_RESPONSE")); } finally { client.close(); }
  }
  const mock = mocked({ raw: Buffer.alloc(1024 * 1024 + 1, 32) }), client = new NfseNationalReadClient({ pfx, passphrase }, { requester: mock.requester });
  try { await assert.rejects(client.getMunicipalAgreement("3550308"), e => safe(e, "OFFICIAL_RESPONSE_TOO_LARGE")); } finally { client.close(); }
});

test("NFSD07 deadline absoluto encerra requisição sem resposta e não tenta novamente", async () => {
  const { NfseNationalReadClient } = await load(), mock = mocked({ hang: true });
  const client = new NfseNationalReadClient({ pfx, passphrase }, { requester: mock.requester, timeoutMs: 100 });
  try { await assert.rejects(client.getMunicipalAgreement("3550308"), e => safe(e, "OFFICIAL_REQUEST_TIMEOUT")); assert.equal(mock.calls.length, 1); } finally { client.close(); }
});

test("NFSD08 fechar cliente aborta pendências, libera agente e bloqueia novas consultas", async () => {
  const { NfseNationalReadClient } = await load(), mock = mocked({ hang: true });
  const client = new NfseNationalReadClient({ pfx, passphrase }, { requester: mock.requester });
  const pending = client.getMunicipalAgreement("3550308"), checked = assert.rejects(pending, e => safe(e, "OFFICIAL_CLIENT_CLOSED"));
  client.close(); await checked; client.close();
  await assert.rejects(client.getMunicipalAgreement("3550308"), e => safe(e, "OFFICIAL_CLIENT_CLOSED")); assert.equal(mock.calls.length, 1);
});

for (const trustFixture of [true, false]) test(`NFSD${trustFixture ? "09" : "10"} HTTPS real isolado ${trustFixture ? "apresenta certificado cliente e valida servidor" : "recusa servidor sem cadeia confiável"}`, async () => {
  const cert = await readFile(join(directory, "qa-cert.pem")), key = await readFile(join(directory, "qa-key.pem"));
  let requests = 0, authenticated = false;
  const server = createServer({ key, cert, ca: cert, requestCert: true, rejectUnauthorized: true }, (req, res) => {
    requests++; authenticated = Boolean((req.socket as any).authorized);
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ conveniado: false }));
  });
  server.on("tlsClientError", () => { /* Expected in the untrusted-server case; never log crypto material. */ });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  try {
    const port = (server.address() as AddressInfo).port;
    const script = `
      import assert from 'node:assert/strict';
      import {readFile} from 'node:fs/promises';
      import {request} from 'node:https';
      import {NfseNationalReadClient} from './src/nfse-national-read-client.ts';
      const pfx=await readFile(process.env.QA_PFX_FILE);
      const requester=(url,settings,callback)=>{
        assert.equal(url.hostname,'sefin.producaorestrita.nfse.gov.br');
        return request(new URL('https://127.0.0.1:'+process.env.QA_TLS_PORT+'/qa'),settings,callback);
      };
      const client=new NfseNationalReadClient({pfx,passphrase:process.env.QA_PFX_PASSWORD},{requester,timeoutMs:3000});
      try {
        if(process.env.QA_TRUST==='yes') assert.deepEqual(await client.getMunicipalAgreement('3550308'),{conveniado:false});
        else await assert.rejects(client.getMunicipalAgreement('3550308'),{code:'OFFICIAL_SERVICE_UNAVAILABLE'});
        console.log('QA_TLS_OK');
      }finally{client.close();pfx.fill(0);}
    `;
    const env = { ...process.env, QA_PFX_FILE: join(directory, "qa-client.pfx"), QA_PFX_PASSWORD: passphrase, QA_TLS_PORT: String(port), QA_TRUST: trustFixture ? "yes" : "no", NODE_EXTRA_CA_CERTS: trustFixture ? join(directory, "qa-cert.pem") : "" };
    const result = await promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { cwd: resolve(import.meta.dirname, ".."), env, windowsHide: true, timeout: 15000 });
    assert.equal(result.stdout.trim(), "QA_TLS_OK"); assert.equal(requests, trustFixture ? 1 : 0); assert.equal(authenticated, trustFixture);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); key.fill(0); }
});

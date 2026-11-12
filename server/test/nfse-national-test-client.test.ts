import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { gunzipSync } from "node:zlib";
import type { request, RequestOptions } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { createA1Fixture } from "./nfse-a1-fixture.ts";
import { dpsId, unsignedDpsXml } from "./nfse-dps-fixture.ts";
import { experimentalSignatureProfile, signDpsOffline } from "../src/nfse-dps-signature.ts";

let fixture: Awaited<ReturnType<typeof createA1Fixture>>, xml: string;
before(async () => {
  fixture = await createA1Fixture(["valid"]);
  xml = signDpsOffline({ xml: unsignedDpsXml, issuerCnpj: "11222333000181", at: fixture.now, profile: experimentalSignatureProfile,
    credentials: { pfx: fixture.materials.valid.pfx, passphrase: fixture.passphrase } }).xml;
});
after(async () => { await fixture?.close(); });
const load = () => import("../src/nfse-national-test-client.ts");
function mock(reply: { status?: number; body?: unknown; raw?: Buffer; type?: string; hang?: boolean; error?: boolean } = {}) {
  const calls: { url: URL; options: RequestOptions; body?: Buffer }[] = [];
  const requester = ((url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void) => {
    const req = new EventEmitter() as ClientRequest;
    req.destroy = (() => req) as ClientRequest["destroy"];
    const entry = { url, options, body: undefined as Buffer | undefined }; calls.push(entry);
    req.end = ((data?: Buffer) => {
      entry.body = data;
      queueMicrotask(() => {
        if (reply.hang) return;
        if (reply.error) { req.emit("error", new Error("Private native error QA")); return; }
        const stream = Object.assign(new PassThrough(), { statusCode: reply.status ?? 200, headers: { "content-type": reply.type ?? "application/json" }, complete: true });
        callback(stream as unknown as IncomingMessage);
        stream.end(reply.raw ?? Buffer.from(JSON.stringify(reply.body ?? { chaveAcesso: "1".repeat(50), cStat: "100" })));
      }); return req;
    }) as ClientRequest["end"]; return req;
  }) as typeof request;
  return { calls, requester };
}
async function using(reply: Parameters<typeof mock>[0], run: (client: any, wire: ReturnType<typeof mock>) => Promise<void>, timeoutMs = 1000) {
  const { NfseNationalTestClient } = await load(), wire = mock(reply);
  const client = new NfseNationalTestClient({ pfx: fixture.materials.valid.pfx, passphrase: fixture.passphrase }, { requester: wire.requester, timeoutMs });
  try { await run(client, wire); } finally { client.close(); }
}

test("NTR01 envelope candidato usa gzip/base64, um POST restrito e não afirma autorização", async () => {
  await using({}, async (client, wire) => {
    const result = await client.submitDps(xml);
    assert.equal(wire.calls.length, 1); const call = wire.calls[0];
    assert.equal(call.url.href, "https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional/nfse");
    assert.equal(call.options.method, "POST"); assert.equal(call.options.rejectUnauthorized, true); assert.equal(call.options.minVersion, "TLSv1.2");
    const body = JSON.parse(call.body!.toString("utf8")); assert.deepEqual(Object.keys(body), ["dpsXmlGZipB64"]);
    assert.equal(gunzipSync(Buffer.from(body.dpsXmlGZipB64, "base64")).toString("utf8"), xml);
    assert.equal((call.options.headers as any)["Content-Length"], call.body!.length);
    assert.equal(result.httpStatus, 200); assert.equal(result.authorizationConfirmed, false); assert.equal(result.contractConfirmed, false);
    assert.equal(result.payload.cStat, "100"); assert.ok(!JSON.stringify(client).includes(fixture.passphrase));
  });
});
test("NTR02 consulta a mesma DPS/nota por rotas oficiais, incluindo chave alfanumérica do XSD", async () => {
  await using({}, async (client, wire) => {
    await client.getDps(dpsId); const key = "123456" + "A1B2C3D4E5F678" + "1".repeat(30); await client.getNfse(key);
    assert.equal(wire.calls[0].url.pathname, "/API/SefinNacional/dps/" + dpsId);
    assert.equal(wire.calls[1].url.pathname, "/API/SefinNacional/nfse/" + key);
    assert.ok(wire.calls.every(call => call.options.method === "GET" && !call.body));
  });
});
test("NTR03 entradas e opções inválidas não chegam à rede", async () => {
  await using({}, async (client, wire) => {
    for (const value of ["", "../a", dpsId + "?x", "https://example.test"]) await assert.rejects(client.getDps(value));
    for (const value of ["", "../a", "1".repeat(51)]) await assert.rejects(client.getNfse(value));
    for (const value of ["", unsignedDpsXml, xml + " ".repeat(164000)]) await assert.rejects(client.submitDps(value));
    assert.equal(wire.calls.length, 0);
  });
  const { NfseNationalTestClient } = await load();
  for (const options of [{ baseUrl: "https://example.test" }, { environment: "production" }, { rejectUnauthorized: false }])
    assert.throws(() => new NfseNationalTestClient({ pfx: fixture.materials.valid.pfx, passphrase: fixture.passphrase }, options as any));
});
test("NTR04 HTTP400/422 não vira rejeição fiscal confirmada nem provoca retry", async () => {
  for (const status of [400, 422]) await using({ status, body: { erros: [{ Codigo: "QA", Descricao: "Recusa de QA" }] } }, async (client, wire) => {
    const result = await client.submitDps(xml); assert.equal(result.httpStatus, status); assert.equal(result.authorizationConfirmed, false); assert.equal(result.contractConfirmed, false); assert.equal(wire.calls.length, 1);
  });
});
test("NTR05 redirect/5xx/JSON inválido/resposta excessiva são inconclusivos após POST, sem retry", async () => {
  for (const reply of [{ status: 302 }, { status: 503 }, { raw: Buffer.from("invalid-json") }, { type: "text/html" }, { raw: Buffer.alloc(1024 * 1024 + 1, 65) }])
    await using(reply, async (client, wire) => {
      await assert.rejects(client.submitDps(xml), (error: any) => { assert.equal(error.requestMayHaveBeenProcessed, true); assert.ok(!String(error).includes("Private")); return true; });
      assert.equal(wire.calls.length, 1);
    });
});
test("NTR06 erro/timeout de POST não equivalem a rejeição e fechar encerra requisições", async () => {
  for (const reply of [{ error: true }, { hang: true }]) await using(reply, async (client, wire) => {
    await assert.rejects(client.submitDps(xml), (error: any) => error.requestMayHaveBeenProcessed === true); assert.equal(wire.calls.length, 1);
  }, 100);
  await using({ hang: true }, async (client) => {
    const pending = client.submitDps(xml); client.close();
    await assert.rejects(pending, (error: any) => error.code === "OFFICIAL_CLIENT_CLOSED" && error.requestMayHaveBeenProcessed === true);
    await assert.rejects(client.getDps(dpsId));
  });
});

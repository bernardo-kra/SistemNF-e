import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { after, before, test } from "node:test";
import { readConfig } from "../src/config.ts";

let keyfile: typeof import("../src/nfse-a1-keyfile.ts");
let cli: typeof import("../scripts/a1-keyring.ts");
const root = resolve(import.meta.dirname, "../.local/tests");
let directory: string;
before(async () => {
  keyfile = await import("../src/nfse-a1-keyfile.ts");
  cli = await import("../scripts/a1-keyring.ts");
  await mkdir(root, { recursive: true });
  directory = await mkdtemp(join(root, "keyfile-"));
});
after(async () => {
  if (!directory) return;
  const target = resolve(directory);
  if (!target.startsWith(root + sep + "keyfile-")) throw Error("Invalid generic keyfile cleanup");
  await rm(target, { recursive: true, force: true });
});
const document = (id = "first") => ({ activeKeyId: id, keys: { [id]: randomBytes(32).toString("base64") } });
const safeError = (error: unknown) => {
  assert.ok(error instanceof Error);
  assert.equal(error.message, "Configuração protegida do A1 inválida.");
  assert.equal(error.cause, undefined);
  return true;
};
test("KEY01 keyfile loads dedicated keys, with no environment/auth-secret fallback", async () => {
  const input = document(), path = join(directory, "valid.json");
  await writeFile(path, JSON.stringify(input), { mode: 0o600 });
  const loaded = keyfile.loadA1KeyringFile(path);
  assert.equal(loaded.activeKeyId, "first");
  assert.deepEqual(loaded.keys.first, Buffer.from(input.keys.first, "base64"));
  loaded.keys.first.fill(0);
  assert.equal(JSON.parse(await readFile(path, "utf8")).keys.first, input.keys.first);
  assert.throws(() => keyfile.loadA1KeyringFile("relative.json"), safeError);
  assert.throws(() => keyfile.loadA1KeyringFile(join(directory, "missing.json")), safeError);
});
test("KEY02 malformed, oversized and nonregular keyfiles fail closed without content/path in error", async () => {
  const path = join(directory, "invalid.json");
  for (const data of ["private invalid JSON", "x".repeat(2049), JSON.stringify({ ...document(), password: "private" }), JSON.stringify({ activeKeyId: "first", keys: { first: "short" } }), JSON.stringify({ activeKeyId: "missing", keys: document().keys }), JSON.stringify({ activeKeyId: "first", keys: Object.fromEntries(["first", "b", "c", "d", "e"].map(id => [id, randomBytes(32).toString("base64")])) })]) {
    await writeFile(path, data, { mode: 0o600 });
    assert.throws(() => keyfile.loadA1KeyringFile(path), safeError);
  }
  assert.throws(() => keyfile.loadA1KeyringFile(directory), safeError);
  if (process.platform !== "win32") {
    await writeFile(path, JSON.stringify(document()));
    await chmod(path, 0o644);
    assert.throws(() => keyfile.loadA1KeyringFile(path), safeError);
  }
});
test("KEY03 explicit generation/rotation writes a new file, preserves old keys, and never overwrites", async () => {
  const original = join(directory, "original.json"), rotated = join(directory, "rotated.json");
  cli.createA1KeyringFile({ output: original, keyId: "first" });
  const before = await readFile(original, "utf8");
  cli.createA1KeyringFile({ output: rotated, keyId: "second", source: original });
  const next = keyfile.loadA1KeyringFile(rotated);
  assert.equal(next.activeKeyId, "second");
  assert.deepEqual(next.keys.first, Buffer.from(JSON.parse(before).keys.first, "base64"));
  assert.equal(next.keys.second.length, 32);
  assert.ok(!next.keys.first.equals(next.keys.second));
  assert.equal(await readFile(original, "utf8"), before);
  assert.throws(() => cli.createA1KeyringFile({ output: original, keyId: "third" }));
  assert.equal(await readFile(original, "utf8"), before);
  for (const value of Object.values(next.keys)) value.fill(0);
});
test("KEY04 rotation refuses a fifth or duplicate ID without removing historical keys", async () => {
  const source = join(directory, "four.json"), output = join(directory, "not-created.json");
  await writeFile(source, JSON.stringify({ activeKeyId: "first", keys: Object.fromEntries(["first", "b", "c", "d"].map(id => [id, randomBytes(32).toString("base64")])) }), { mode: 0o600 });
  const before = await readFile(source, "utf8");
  for (const keyId of ["first", "fifth"]) assert.throws(() => cli.createA1KeyringFile({ output, source, keyId }));
  assert.equal(await readFile(source, "utf8"), before);
  await assert.rejects(readFile(output));
});
test("KEY05 API config accepts only an explicit absolute keyfile path, optional when feature disabled", () => {
  const env = { NODE_ENV: "test", API_BASE_URL: "http://127.0.0.1:4000", FRONTEND_ORIGIN: "http://127.0.0.1:3000", BETTER_AUTH_SECRET: "generic-test-auth-secret-longer-than-thirty-two", CONTROL_DATABASE_URL: "postgresql://qa:generic@127.0.0.1/control", TENANT_DATABASE_URLS: JSON.stringify({ a: "postgresql://qa:generic@127.0.0.1/tenant" }) };
  assert.equal(readConfig(env).a1KeyringFile, undefined);
  const path = join(directory, "valid.json");
  assert.equal(readConfig({ ...env, NFS_E_A1_KEYRING_FILE: path }).a1KeyringFile, path);
  assert.throws(() => readConfig({ ...env, NFS_E_A1_KEYRING_FILE: "relative.json" }));
});

test("KEY06 Unix keyfiles accept only owner 0400/0600, never executable or write-only modes", { skip: process.platform === "win32" }, async () => {
  const path = join(directory, "unix-mode.json");
  await writeFile(path, JSON.stringify(document()), { mode: 0o600 });
  for (const mode of [0o700, 0o500, 0o200]) {
    await chmod(path, mode);
    assert.throws(() => keyfile.loadA1KeyringFile(path), safeError);
  }
  await chmod(path, 0o600);
});

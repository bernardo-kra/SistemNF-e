import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { A1Keyring } from "./nfse-a1-custody.js";

const keyId = /^[a-z][a-z0-9_-]{0,31}$/;
export const invalidA1Keyfile = () => new Error("Configuração protegida do A1 inválida.");
export function clearA1Keyring(keys: A1Keyring | undefined) {
  if (keys) for (const value of Object.values(keys.keys)) value.fill(0);
}

/** Read only an explicitly configured server secret, never a request-supplied path. */
export function loadA1KeyringFile(path: string): A1Keyring {
  let descriptor: number | undefined;
  const buffer = Buffer.alloc(2049);
  const keys: Record<string, Buffer> = Object.create(null);
  try {
    if (!isAbsolute(path) || !lstatSync(path).isFile()) throw invalidA1Keyfile();
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > 2048 || stat.size < 1
      || (process.platform !== "win32" && (![0o400, 0o600].includes(stat.mode & 0o777) || stat.uid !== process.getuid?.()))) throw invalidA1Keyfile();
    let size = 0;
    while (size < buffer.length) {
      const read = readSync(descriptor, buffer, size, buffer.length - size, null);
      if (!read) break;
      size += read;
    }
    if (size > 2048) throw invalidA1Keyfile();
    const input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size)));
    if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).some(name => !["activeKeyId", "keys"].includes(name))
      || typeof input.activeKeyId !== "string" || !keyId.test(input.activeKeyId)
      || !input.keys || typeof input.keys !== "object" || Array.isArray(input.keys)) throw invalidA1Keyfile();
    const entries = Object.entries(input.keys);
    if (!entries.length || entries.length > 4) throw invalidA1Keyfile();
    for (const [id, value] of entries) {
      if (!keyId.test(id) || typeof value !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw invalidA1Keyfile();
      const bytes = Buffer.from(value, "base64");
      keys[id] = bytes;
      if (bytes.length !== 32 || bytes.toString("base64") !== value) throw invalidA1Keyfile();
    }
    if (!Object.hasOwn(keys, input.activeKeyId)) throw invalidA1Keyfile();
    return { activeKeyId: input.activeKeyId, keys };
  } catch {
    clearA1Keyring({ activeKeyId: "", keys });
    throw invalidA1Keyfile();
  } finally {
    buffer.fill(0);
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { throw invalidA1Keyfile(); }
    }
  }
}

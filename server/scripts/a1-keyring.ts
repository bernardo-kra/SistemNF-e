import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { clearA1Keyring, invalidA1Keyfile, loadA1KeyringFile } from "../src/nfse-a1-keyfile.js";
import type { A1Keyring } from "../src/nfse-a1-custody.js";

/** Explicit offline setup only. New destination, never replace or discard historical keys. */
export function createA1KeyringFile(options: { output: string; keyId: string; source?: string }) {
  let keys: A1Keyring | undefined;
  let encoded: Buffer | undefined;
  try {
    if (!isAbsolute(options.output) || !/^[a-z][a-z0-9_-]{0,31}$/.test(options.keyId)) throw invalidA1Keyfile();
    keys = options.source ? loadA1KeyringFile(options.source) : { activeKeyId: options.keyId, keys: Object.create(null) };
    if (Object.keys(keys.keys).length >= 4 || Object.hasOwn(keys.keys, options.keyId)) throw invalidA1Keyfile();
    const next = { ...keys.keys, [options.keyId]: randomBytes(32) };
    keys = { activeKeyId: options.keyId, keys: next };
    encoded = Buffer.from(JSON.stringify({ activeKeyId: keys.activeKeyId, keys: Object.fromEntries(Object.entries(next).map(([id, value]) => [id, value.toString("base64")])) }));
    writeFileSync(options.output, encoded, { flag: "wx", mode: 0o600 });
  } catch {
    throw invalidA1Keyfile();
  } finally {
    encoded?.fill(0);
    clearA1Keyring(keys);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2), parsed: Record<string, string> = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!["--output", "--key-id", "--source"].includes(args[i]) || !args[i + 1] || parsed[args[i]]) throw invalidA1Keyfile();
      parsed[args[i]] = args[i + 1];
    }
    createA1KeyringFile({ output: parsed["--output"], keyId: parsed["--key-id"], source: parsed["--source"] });
    console.log("Arquivo de chaves criado. Proteja o acesso e mantenha backup privado.");
  } catch {
    console.error("Não foi possível criar o arquivo de chaves. Confira os argumentos e a proteção do destino.");
    process.exitCode = 1;
  }
}

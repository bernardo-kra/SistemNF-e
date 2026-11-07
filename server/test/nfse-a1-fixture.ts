import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";

// Shared generic certificates, generated only inside an isolated QA directory.
export async function createA1Fixture(names = ["valid", "different", "noIdentity", "wrongIdentity", "ca", "usage", "weak"]) {
  const root = resolve(import.meta.dirname, "../.local/tests");
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(join(root, "nfse-a1-"));
  const passphrase = randomBytes(32).toString("base64url");
  const materials: Record<string, { pfx: Buffer; certificatePem: string; keyPem: string }> = {};
  async function close() {
    for (const value of Object.values(materials)) value.pfx.fill(0);
    const target = resolve(directory);
    if (!target.startsWith(root + sep + "nfse-a1-")) throw Error("Invalid QA certificate directory");
    await rm(target, { recursive: true, force: true });
  }
  try {
    const run = promisify(execFile);
    const openssl = process.env.SISTEM_TEST_OPENSSL ?? (process.platform === "win32" ? "C:\\Program Files\\Git\\usr\\bin\\openssl.exe" : "openssl");
    for (const name of names) {
      if (!["valid", "different", "noIdentity", "wrongIdentity", "ca", "usage", "weak"].includes(name)) throw Error("Unknown QA certificate");
      const key = join(directory, `${name}.key`), cert = join(directory, `${name}.crt`), pfx = join(directory, `${name}.pfx`);
      const options = { windowsHide: true, timeout: 20000, env: { ...process.env, SISTEM_NFSD_SIGNATURE_QA: passphrase } };
      await run(openssl, ["req", "-x509", "-newkey", name === "weak" ? "rsa:1024" : "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", name === "noIdentity" ? "/CN=11222333000181" : "/CN=Sistem Generic QA Only",
        "-addext", name === "ca" ? "basicConstraints=critical,CA:TRUE" : "basicConstraints=critical,CA:FALSE",
        "-addext", name === "usage" ? "keyUsage=critical,digitalSignature" : "keyUsage=critical,digitalSignature,nonRepudiation",
        ...(name === "noIdentity" ? [] : ["-addext", `subjectAltName=otherName:2.16.76.1.3.3;UTF8:${name === "wrongIdentity" ? "11444777000161" : "11222333000181"}`])], options);
      await run(openssl, ["pkcs12", "-export", "-inkey", key, "-in", cert, "-out", pfx, "-passout", "env:SISTEM_NFSD_SIGNATURE_QA"], options);
      materials[name] = { pfx: await readFile(pfx), certificatePem: await readFile(cert, "utf8"), keyPem: await readFile(key, "utf8") };
    }
    return { materials, passphrase, now: new Date(), close };
  } catch {
    await close();
    throw Error("Generic QA certificate setup failed");
  }
}

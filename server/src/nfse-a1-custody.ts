import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { allowedKeys, inputRecord, requireUuid } from "./customers.js";
import { ApiError, conflict, notFound, unavailable } from "./errors.js";
import { readDpsWithinTransaction, withDpsTransaction, type DpsJournalAccess } from "./nfse-dps-journal.js";
import { DpsSigningTaskError, inspectA1Isolated, signDpsIsolated } from "./nfse-dps-isolation.js";
import { NfseDpsError, requireDpsDocument } from "./nfse-dps-validation.js";
import { dpsSignatureCommand, persistDpsSignatureWithinTransaction, recoverDpsSignatureWithinTransaction } from "./nfse-dps-signature-journal.js";

/** Internal server configuration only. Never take this keyring from a request/user. */
export type A1Keyring = { activeKeyId: string; keys: Readonly<Record<string, Buffer>> };
type Keys = { activeKeyId: string; keys: Map<string, Buffer> };
type Credentials = { pfx: Buffer; passphrase: string };
type Options = { timeoutMs?: number; signal?: AbortSignal };
type CertificateRow = {
  tenant_id: string;
  version: number;
  issuer_cnpj: string;
  fingerprint: string;
  valid_from: Date;
  valid_to: Date;
  key_bits: number;
  key_id: string;
  nonce: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
  updated_by: string;
  updated_at: Date;
};
type CertificateContext = Omit<CertificateRow, "nonce" | "tag" | "ciphertext">;
type Command = {
  requestId: string;
  version: number;
  profileVersion: number;
  issuerCnpj: string;
  credentials: Credentials;
};
const publicColumns = "tenant_id,version,issuer_cnpj,fingerprint,valid_from,valid_to,key_bits,key_id,updated_by,updated_at";
const keyIdPattern = /^[a-z][a-z0-9_-]{0,31}$/;
const format = "Sistem-NFSe-A1-v1";
const fail = (code: string, status = 503) => new ApiError(status, code, "Não foi possível usar o certificado. Confira a configuração fiscal e tente novamente.");

function metadata(row: CertificateContext) {
  return {
    version: row.version,
    issuerCnpj: row.issuer_cnpj,
    certificateFingerprint256: row.fingerprint,
    validFrom: row.valid_from.toISOString(),
    validTo: row.valid_to.toISOString(),
    keyBits: row.key_bits,
    keyId: row.key_id,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at.toISOString(),
    readyForSubmission: false as const,
    officialProfileConfirmed: false as const,
    trustChainVerified: false as const,
    revocationChecked: false as const,
  };
}
type Metadata = ReturnType<typeof metadata>;

function snapshotKeys(raw: A1Keyring): Keys {
  const keys = new Map<string, Buffer>();
  try {
    if (!raw || typeof raw !== "object" || Object.keys(raw).some(key => !["activeKeyId", "keys"].includes(key))
      || typeof raw.activeKeyId !== "string" || !keyIdPattern.test(raw.activeKeyId)
      || !raw.keys || typeof raw.keys !== "object" || Array.isArray(raw.keys)) throw Error();
    const entries = Object.entries(raw.keys);
    if (!entries.length || entries.length > 4) throw Error();
    for (const [id, bytes] of entries) {
      if (!keyIdPattern.test(id) || !Buffer.isBuffer(bytes) || bytes.length !== 32) throw Error();
      keys.set(id, Buffer.from(bytes));
    }
    if (!keys.has(raw.activeKeyId)) throw Error();
    return { activeKeyId: raw.activeKeyId, keys };
  } catch {
    for (const bytes of keys.values()) bytes.fill(0);
    throw fail("A1_KEY_UNAVAILABLE");
  }
}

async function usingKeys<T>(raw: A1Keyring, run: (keys: Keys) => Promise<T>): Promise<T> {
  const keys = snapshotKeys(raw);
  try {
    return await run(keys);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DpsSigningTaskError) {
      if (error.code === "SIGNING_FAILED") throw fail("A1_CERTIFICATE_REJECTED", 400);
      throw fail(error.code);
    }
    throw unavailable();
  } finally {
    for (const bytes of keys.keys.values()) bytes.fill(0);
  }
}

function derivedKey(keys: Keys, id: string, tenantId: string, purpose: "encryption" | "requests") {
  const master = keys.keys.get(id);
  if (!master) throw fail("A1_KEY_UNAVAILABLE");
  return Buffer.from(hkdfSync("sha256", master, Buffer.from(tenantId), `${format}/${purpose}`, 32));
}

function command(raw: unknown): Command {
  const body = inputRecord(raw);
  allowedKeys(body, ["requestId", "version", "profileVersion", "issuerCnpj", "credentials"]);
  const credentials = inputRecord(body.credentials);
  allowedKeys(credentials, ["pfx", "passphrase"]);
  if (!Number.isSafeInteger(body.version) || Number(body.version) < 0 || Number(body.version) > 2147483646
    || !Number.isSafeInteger(body.profileVersion) || Number(body.profileVersion) < 1
    || typeof body.issuerCnpj !== "string" || !/^[A-Z0-9]{12}\d{2}$/.test(body.issuerCnpj)
    || !Buffer.isBuffer(credentials.pfx) || !credentials.pfx.length || credentials.pfx.length > 1024 * 1024
    || typeof credentials.passphrase !== "string" || credentials.passphrase.length > 1024) throw fail("A1_INVALID_INPUT", 400);
  let issuerCnpj: string;
  try {
    issuerCnpj = requireDpsDocument("CNPJ", body.issuerCnpj);
  } catch (error) {
    if (error instanceof NfseDpsError) throw fail("A1_INVALID_INPUT", 400);
    throw error;
  }
  return {
    requestId: requireUuid(body.requestId),
    version: body.version as number,
    profileVersion: body.profileVersion as number,
    issuerCnpj,
    credentials: { pfx: Buffer.from(credentials.pfx), passphrase: credentials.passphrase },
  };
}

function associatedData(row: CertificateContext, tenantId: string) {
  return Buffer.from(JSON.stringify([format, tenantId, row.version, row.issuer_cnpj, row.fingerprint,
    row.valid_from.toISOString(), row.valid_to.toISOString(), row.key_bits, row.key_id, row.updated_by, row.updated_at.toISOString()]));
}

function encode(credentials: Credentials) {
  const password = Buffer.from(credentials.passphrase, "utf16le"); // Preserve exact JS password, including whitespace/code units.
  try {
    const payload = Buffer.alloc(8 + credentials.pfx.length + password.length);
    payload.writeUInt32BE(credentials.pfx.length, 0);
    payload.writeUInt32BE(password.length, 4);
    credentials.pfx.copy(payload, 8);
    password.copy(payload, 8 + credentials.pfx.length);
    return payload;
  } finally {
    password.fill(0);
  }
}

function encrypt(row: CertificateContext, keys: Keys, credentials: Credentials) {
  const key = derivedKey(keys, row.key_id, row.tenant_id, "encryption");
  const payload = encode(credentials);
  try {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
    cipher.setAAD(associatedData(row, row.tenant_id));
    return { nonce, ciphertext: Buffer.concat([cipher.update(payload), cipher.final()]), tag: cipher.getAuthTag() };
  } finally {
    payload.fill(0);
    key.fill(0);
  }
}

function decrypt(row: CertificateRow, keys: Keys, tenantId: string): Credentials {
  const key = derivedKey(keys, row.key_id, tenantId, "encryption");
  let provisional: Buffer | undefined;
  let final: Buffer | undefined;
  let payload: Buffer | undefined;
  try {
    if (!Buffer.isBuffer(row.nonce) || row.nonce.length !== 12 || !Buffer.isBuffer(row.tag) || row.tag.length !== 16
      || !Buffer.isBuffer(row.ciphertext) || row.ciphertext.length < 9 || row.ciphertext.length > 1050632) throw Error();
    const decipher = createDecipheriv("aes-256-gcm", key, row.nonce, { authTagLength: 16 });
    decipher.setAAD(associatedData(row, tenantId));
    decipher.setAuthTag(row.tag);
    provisional = decipher.update(row.ciphertext);
    final = decipher.final(); // Authenticate before inspecting or exposing any plaintext.
    payload = Buffer.concat([provisional, final]);
    const pfxLength = payload.readUInt32BE(0);
    const passwordLength = payload.readUInt32BE(4);
    if (!pfxLength || pfxLength > 1048576 || passwordLength > 2048 || passwordLength % 2 || payload.length !== 8 + pfxLength + passwordLength) throw Error();
    return { pfx: Buffer.from(payload.subarray(8, 8 + pfxLength)), passphrase: payload.subarray(8 + pfxLength).toString("utf16le") };
  } catch {
    throw fail("A1_CUSTODY_INTEGRITY");
  } finally {
    key.fill(0);
    provisional?.fill(0);
    final?.fill(0);
    payload?.fill(0);
  }
}

function sameCredentials(first: Credentials, second: Credentials) {
  const a = Buffer.from(first.passphrase, "utf16le");
  const b = Buffer.from(second.passphrase, "utf16le");
  try {
    return first.pfx.length === second.pfx.length && timingSafeEqual(first.pfx, second.pfx)
      && a.length === b.length && timingSafeEqual(a, b);
  } finally {
    a.fill(0);
    b.fill(0);
  }
}

function requestMac(keys: Keys, keyId: string, access: DpsJournalAccess, data: Command, result: Metadata) {
  const key = derivedKey(keys, keyId, access.tenantId, "requests");
  const password = Buffer.from(data.credentials.passphrase, "utf16le");
  const publicResult = Object.keys(result).sort().map(name => [name, (result as Record<string, unknown>)[name]]);
  const header = Buffer.from(JSON.stringify([format, access.tenantId, access.actorId, data.requestId, data.version, data.profileVersion, data.issuerCnpj, publicResult]));
  const lengths = Buffer.alloc(12);
  lengths.writeUInt32BE(header.length, 0);
  lengths.writeUInt32BE(data.credentials.pfx.length, 4);
  lengths.writeUInt32BE(password.length, 8);
  try {
    return createHmac("sha256", key).update(lengths).update(header).update(data.credentials.pfx).update(password).digest("hex");
  } finally {
    key.fill(0);
    password.fill(0);
  }
}

async function replay(client: PoolClient, access: DpsJournalAccess, keys: Keys, data: Command): Promise<Metadata | null> {
  const previous = (await client.query("SELECT tenant_id,actor_id,key_id,mac,result FROM nfse_a1_requests WHERE id=$1", [data.requestId])).rows[0];
  if (!previous) return null;
  if (previous.tenant_id !== access.tenantId || previous.actor_id !== access.actorId) throw conflict();
  const result = previous.result as Metadata;
  if (!result || typeof result !== "object" || !Number.isSafeInteger(result.version)
    || [result.readyForSubmission, result.officialProfileConfirmed, result.trustChainVerified, result.revocationChecked].some(value => value !== false)) throw fail("A1_CUSTODY_INTEGRITY");
  const mac = requestMac(keys, previous.key_id, access, data, result);
  if (typeof previous.mac !== "string" || !/^[a-f0-9]{64}$/.test(previous.mac) || !timingSafeEqual(Buffer.from(mac, "hex"), Buffer.from(previous.mac, "hex"))) throw conflict();
  return result;
}

async function requireProfile(client: PoolClient, access: DpsJournalAccess, data: Command) {
  const profile = (await client.query("SELECT version,body->>'cnpj' AS cnpj FROM fiscal_records WHERE kind='profile' AND entity_id=$1 AND tenant_id=$1", [access.tenantId])).rows[0];
  if (profile?.version !== data.profileVersion || profile.cnpj !== data.issuerCnpj) throw fail("A1_PROFILE_CONFLICT", 409);
}

/** Internal only: caller authenticates/authorizes fiscal access before supplying the tenant pool. */
export function readA1Certificate(rawAccess: DpsJournalAccess) {
  const access = { ...rawAccess, tenantId: requireUuid(rawAccess.tenantId) };
  return withDpsTransaction(access, false, async client => {
    const row = (await client.query<CertificateContext>(`SELECT ${publicColumns} FROM nfse_a1_custody WHERE tenant_id=$1`, [access.tenantId])).rows[0];
    return row ? metadata(row) : null;
  });
}

/** Trusted/pre-controlled material only. No HTTP/upload handler, master-key persistence or fiscal submission. */
export function saveA1Certificate(rawAccess: DpsJournalAccess, rawKeys: A1Keyring, raw: unknown, options: Options = {}) {
  const access = { ...rawAccess, tenantId: requireUuid(rawAccess.tenantId) };
  return usingKeys(rawKeys, async keys => {
    const data = command(raw);
    try {
      const previous = await withDpsTransaction(access, false, async client => {
        const found = await replay(client, access, keys, data);
        if (found) return found;
        const current = (await client.query("SELECT version FROM nfse_a1_custody WHERE tenant_id=$1", [access.tenantId])).rows[0];
        if ((current?.version ?? 0) !== data.version) throw conflict();
        await requireProfile(client, access, data);
        return null;
      });
      if (previous) return previous;
      const inspected = await inspectA1Isolated({ credentials: data.credentials, issuerCnpj: data.issuerCnpj, at: new Date() }, options);
      return await withDpsTransaction(access, true, async client => {
        const found = await replay(client, access, keys, data);
        if (found) return found;
        const old = (await client.query<CertificateRow>("SELECT * FROM nfse_a1_custody WHERE tenant_id=$1 FOR UPDATE", [access.tenantId])).rows[0];
        if ((old?.version ?? 0) !== data.version) throw conflict();
        await requireProfile(client, access, data);
        let unchanged = false;
        if (old) {
          const credentials = decrypt(old, keys, access.tenantId);
          try {
            unchanged = sameCredentials(credentials, data.credentials) && old.key_id === keys.activeKeyId;
          } finally {
            credentials.pfx.fill(0);
          }
        }
        let result = old ? metadata(old) : null;
        if (!unchanged) {
          const at = (await client.query<{ at: Date }>("SELECT date_trunc('milliseconds',clock_timestamp()) AS at")).rows[0].at;
          const next: CertificateContext = {
            tenant_id: access.tenantId,
            version: data.version + 1,
            issuer_cnpj: inspected.issuerCnpj,
            fingerprint: inspected.certificateFingerprint256,
            valid_from: new Date(inspected.validFrom),
            valid_to: new Date(inspected.validTo),
            key_bits: inspected.keyBits,
            key_id: keys.activeKeyId,
            updated_by: access.actorId,
            updated_at: at,
          };
          const encrypted = encrypt(next, keys, data.credentials);
          await client.query(`
            INSERT INTO nfse_a1_custody(
              tenant_id,version,issuer_cnpj,fingerprint,valid_from,valid_to,key_bits,
              key_id,nonce,tag,ciphertext,updated_by,updated_at
            ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
            ON CONFLICT(tenant_id) DO UPDATE SET
              version=EXCLUDED.version,issuer_cnpj=EXCLUDED.issuer_cnpj,fingerprint=EXCLUDED.fingerprint,
              valid_from=EXCLUDED.valid_from,valid_to=EXCLUDED.valid_to,key_bits=EXCLUDED.key_bits,
              key_id=EXCLUDED.key_id,nonce=EXCLUDED.nonce,tag=EXCLUDED.tag,ciphertext=EXCLUDED.ciphertext,
              updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at`, [
            next.tenant_id, next.version, next.issuer_cnpj, next.fingerprint,
            next.valid_from, next.valid_to, next.key_bits, next.key_id,
            encrypted.nonce, encrypted.tag, encrypted.ciphertext, next.updated_by, next.updated_at,
          ]);
          await client.query(`
            INSERT INTO audit_events(id,tenant_id,actor_id,action,entity_type,entity_id,entity_version,field_names)
            VALUES($1,$2,$3,'fiscal.certificate.update','fiscal_certificate',$2,$4,ARRAY['certificate'])`,
          [randomUUID(), access.tenantId, access.actorId, next.version]);
          result = metadata(next);
        }
        if (!result) throw unavailable();
        const mac = requestMac(keys, keys.activeKeyId, access, data, result);
        await client.query(`
          INSERT INTO nfse_a1_requests(id,tenant_id,actor_id,key_id,mac,result)
          VALUES($1,$2,$3,$4,$5,$6)`,
        [data.requestId, access.tenantId, access.actorId, keys.activeKeyId, mac, JSON.stringify(result)]);
        return result;
      });
    } finally {
      data.credentials.pfx.fill(0);
    }
  });
}

type SigningSnapshot = {
  row: CertificateRow;
  draft: Awaited<ReturnType<typeof readDpsWithinTransaction>>;
};
type SignedDps = Awaited<ReturnType<typeof signDpsIsolated>>;

/** Two internal finalizations share crypto, without holding a connection during the child. */
async function withStoredSignature<T>(
  access: DpsJournalAccess, keys: Keys, draftId: string, options: Options,
  finish: (client: PoolClient, snapshot: SigningSnapshot, signed: SignedDps) => Promise<T>,
  expectedCertificateVersion?: number,
) {
  const snapshot = await withDpsTransaction(access, false, async client => {
    const row = (await client.query<CertificateRow>("SELECT * FROM nfse_a1_custody WHERE tenant_id=$1", [access.tenantId])).rows[0];
    if (!row) throw notFound();
    if (expectedCertificateVersion !== undefined && row.version !== expectedCertificateVersion) throw fail("A1_CERTIFICATE_CHANGED", 409);
    const draft = await readDpsWithinTransaction(access, client, draftId);
    return { row, draft };
  });
  const credentials = decrypt(snapshot.row, keys, access.tenantId);
  try {
    const signed = await signDpsIsolated({
      xml: snapshot.draft.xml,
      credentials,
      issuerCnpj: snapshot.row.issuer_cnpj,
      at: new Date(),
      profile: "experimental-rsa-sha256-c14n-v1",
    }, options);
    if (signed.certificateFingerprint256 !== snapshot.row.fingerprint) throw fail("A1_CUSTODY_INTEGRITY");
    return await withDpsTransaction(access, true, client => finish(client, snapshot, signed));
  } finally {
    credentials.pfx.fill(0);
  }
}

async function requireCurrentCertificate(access: DpsJournalAccess, client: PoolClient, snapshot: SigningSnapshot) {
  const current = (await client.query("SELECT version,fingerprint FROM nfse_a1_custody WHERE tenant_id=$1", [access.tenantId])).rows[0];
  if (current?.version !== snapshot.row.version || current.fingerprint !== snapshot.row.fingerprint) throw fail("A1_CERTIFICATE_CHANGED", 409);
}

async function recordSignatureUse(access: DpsJournalAccess, client: PoolClient, snapshot: SigningSnapshot) {
  // Usage has its own sequence; immutable draft/order versions never advance here.
  const usageVersion = (await client.query<{ version: number }>(`
    SELECT COALESCE(MAX(entity_version),0)+1 AS version FROM audit_events
    WHERE tenant_id=$1 AND entity_type='nfse_dps_signature' AND entity_id=$2`,
  [access.tenantId, snapshot.draft.draftId])).rows[0].version;
  await client.query(`
    INSERT INTO audit_events(id,tenant_id,actor_id,action,entity_type,entity_id,entity_version,field_names,after_values)
    VALUES($1,$2,$3,'fiscal.certificate.sign.offline','nfse_dps_signature',$4,$5,ARRAY['offlineSignature'],$6)`, [
    randomUUID(), access.tenantId, access.actorId, snapshot.draft.draftId, usageVersion,
    JSON.stringify({ draftId: snapshot.draft.draftId, certificateVersion: snapshot.row.version, orderVersion: snapshot.draft.orderVersion }),
  ]);
}

/** Sign a stored immutable DPS offline. This original API still does not persist the signature. */
export function signDpsWithStoredA1(rawAccess: DpsJournalAccess, rawKeys: A1Keyring, rawId: unknown, options: Options = {}) {
  const access = { ...rawAccess, tenantId: requireUuid(rawAccess.tenantId) };
  return usingKeys(rawKeys, async keys => {
    const draftId = requireUuid(rawId);
    return withStoredSignature(access, keys, draftId, options, async (client, snapshot, signed) => {
      await requireCurrentCertificate(access, client, snapshot);
      await recordSignatureUse(access, client, snapshot);
      return { ...signed, draftId, certificateVersion: snapshot.row.version, signaturePersisted: false as const };
    });
  });
}

/** Internal, authenticated-caller composition only. Stores an offline artifact, never transmits it. */
export function saveSignedDpsRequest(rawAccess: DpsJournalAccess, rawKeys: A1Keyring, raw: unknown, options: Options = {}) {
  const access = { ...rawAccess, tenantId: requireUuid(rawAccess.tenantId) };
  return usingKeys(rawKeys, async keys => {
    const command = dpsSignatureCommand(raw);
    const existing = await withDpsTransaction(access, true, client => recoverDpsSignatureWithinTransaction(access, client, command));
    if (existing) return existing;
    return withStoredSignature(access, keys, command.draftId, options, async (client, snapshot, signed) => {
      // Another supervisor may have committed while this one calculated. Recover before checking current A1.
      const recovered = await recoverDpsSignatureWithinTransaction(access, client, command);
      if (recovered) return recovered;
      await requireCurrentCertificate(access, client, snapshot);
      const saved = await persistDpsSignatureWithinTransaction(access, client, command, snapshot.draft, signed, snapshot.row.version);
      await recordSignatureUse(access, client, snapshot);
      return saved;
    }, command.certificateVersion);
  });
}

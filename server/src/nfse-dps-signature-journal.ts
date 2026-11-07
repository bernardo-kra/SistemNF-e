import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { allowedKeys, inputRecord, requireUuid } from "./customers.js";
import { ApiError, invalidInput, notFound, unavailable } from "./errors.js";
import { withDpsTransaction, type DpsJournalAccess, type readDpsWithinTransaction } from "./nfse-dps-journal.js";
import type { signDpsIsolated } from "./nfse-dps-isolation.js";

export type DpsSignatureCommand = { requestId: string; draftId: string; certificateVersion: number };
type StoredDraft = Awaited<ReturnType<typeof readDpsWithinTransaction>>;
type SignedDps = Awaited<ReturnType<typeof signDpsIsolated>>;
type SignatureRow = {
  id: string;
  draft_id: string;
  dps_id: string;
  certificate_version: number;
  certificate_fingerprint: string;
  profile: "experimental-rsa-sha256-c14n-v1";
  xml_sha256: string;
  source_xml_sha256: string;
  pending_checks: string[];
  actor_id: string;
  at: Date;
  xml?: string;
};
const columns = "s.id,s.draft_id,d.dps_id,s.certificate_version,s.certificate_fingerprint,s.profile,s.xml_sha256,s.source_xml_sha256,s.pending_checks,s.actor_id,s.at";
const signatureConflict = () => new ApiError(409, "DPS_SIGNATURE_CONFLICT", "A DPS já possui uma assinatura ou solicitação diferente. Nenhum documento foi substituído.");
const sha256 = (xml: string) => createHash("sha256").update(xml).digest("hex");

/** Closed internal intent; signed XML and certificate material never come from this command. */
export function dpsSignatureCommand(raw: unknown): DpsSignatureCommand {
  const body = inputRecord(raw);
  allowedKeys(body, ["requestId", "draftId", "certificateVersion"]);
  if (!Number.isSafeInteger(body.certificateVersion) || Number(body.certificateVersion) < 1 || Number(body.certificateVersion) > 2147483647) throw invalidInput();
  return {
    requestId: requireUuid(body.requestId),
    draftId: requireUuid(body.draftId),
    certificateVersion: body.certificateVersion as number,
  };
}

function metadata(row: SignatureRow) {
  return {
    signatureId: row.id,
    draftId: row.draft_id,
    id: row.dps_id,
    state: "signed_offline" as const,
    environment: "production-restricted" as const,
    profile: row.profile,
    certificateVersion: row.certificate_version,
    certificateFingerprint256: row.certificate_fingerprint,
    xmlSha256: row.xml_sha256,
    sourceXmlSha256: row.source_xml_sha256,
    actorId: row.actor_id,
    createdAt: row.at.toISOString(),
    structurallyValid: true as const,
    cryptographicSignatureValid: true as const,
    signaturePersisted: true as const,
    readyForSubmission: false as const,
    officialProfileConfirmed: false as const,
    trustChainVerified: false as const,
    revocationChecked: false as const,
    pendingChecks: [...row.pending_checks],
  };
}

async function requireDraft(client: PoolClient, access: DpsJournalAccess, draftId: string) {
  if (!(await client.query("SELECT id FROM nfse_dps_drafts WHERE tenant_id=$1 AND id=$2", [access.tenantId, draftId])).rowCount) throw notFound();
}

async function findSignature(client: PoolClient, access: DpsJournalAccess, draftId: string, includeXml = false) {
  return (await client.query<SignatureRow>(`
    SELECT ${columns}${includeXml ? ",s.xml" : ""} FROM nfse_dps_signatures s
    JOIN nfse_dps_drafts d ON d.id=s.draft_id AND d.tenant_id=s.tenant_id
    WHERE s.tenant_id=$1 AND s.draft_id=$2`, [access.tenantId, draftId])).rows[0];
}

async function linkRequest(client: PoolClient, access: DpsJournalAccess, command: DpsSignatureCommand, signatureId: string) {
  await client.query(`
    INSERT INTO nfse_dps_signature_requests(id,tenant_id,actor_id,signature_id)
    VALUES($1,$2,$3,$4)`, [command.requestId, access.tenantId, access.actorId, signatureId]);
}

/** Internal composition only: caller holds the operational lock in withDpsTransaction. */
export async function recoverDpsSignatureWithinTransaction(access: DpsJournalAccess, client: PoolClient, command: DpsSignatureCommand) {
  const previous = (await client.query(`
    SELECT r.tenant_id,r.actor_id,s.draft_id,s.certificate_version
    FROM nfse_dps_signature_requests r JOIN nfse_dps_signatures s ON s.id=r.signature_id
    WHERE r.id=$1`, [command.requestId])).rows[0];
  if (previous && (previous.tenant_id !== access.tenantId || previous.actor_id !== access.actorId
    || previous.draft_id !== command.draftId || previous.certificate_version !== command.certificateVersion)) throw signatureConflict();
  await requireDraft(client, access, command.draftId);
  const stored = await findSignature(client, access, command.draftId);
  if (!stored) return null;
  if (stored.certificate_version !== command.certificateVersion) throw signatureConflict();
  if (!previous) await linkRequest(client, access, command, stored.id);
  return metadata(stored);
}

/** Only the custody coordinator supplies its isolated signer's output, never an HTTP body. */
export async function persistDpsSignatureWithinTransaction(
  access: DpsJournalAccess, client: PoolClient, command: DpsSignatureCommand,
  draft: StoredDraft, signed: SignedDps, certificateVersion: number,
) {
  if (draft.draftId !== command.draftId || signed.id !== draft.id || command.certificateVersion !== certificateVersion) throw unavailable();
  const signatureId = randomUUID();
  await client.query(`
    INSERT INTO nfse_dps_signatures(
      id,tenant_id,draft_id,certificate_version,certificate_fingerprint,profile,
      xml,xml_sha256,source_xml_sha256,pending_checks,actor_id
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [
    signatureId, access.tenantId, draft.draftId, certificateVersion, signed.certificateFingerprint256,
    signed.profile, signed.xml, sha256(signed.xml), sha256(draft.xml), signed.pendingChecks, access.actorId,
  ]);
  await linkRequest(client, access, command, signatureId);
  await client.query(`
    INSERT INTO audit_events(id,tenant_id,actor_id,action,entity_type,entity_id,entity_version,field_names,after_values)
    VALUES($1,$2,$3,'nfse.dps.signature.store','nfse_dps_signed_document',$4,1,ARRAY['offlineSignature'],$5)`, [
    randomUUID(), access.tenantId, access.actorId, signatureId,
    JSON.stringify({ draftId: draft.draftId, certificateVersion, state: "signed_offline", signaturePersisted: true, readyForSubmission: false }),
  ]);
  const stored = await findSignature(client, access, draft.draftId);
  if (!stored) throw unavailable();
  return metadata(stored);
}

/** Internal read only; caller authenticates/authorizes the tenant. Metadata never selects XML. */
export function getSignedDpsMetadata(rawAccess: DpsJournalAccess, rawDraftId: unknown) {
  const access = { ...rawAccess, tenantId: requireUuid(rawAccess.tenantId) };
  const draftId = requireUuid(rawDraftId);
  return withDpsTransaction(access, false, async client => {
    await requireDraft(client, access, draftId);
    const stored = await findSignature(client, access, draftId);
    return stored ? metadata(stored) : null;
  });
}

/** Internal private-document download composition, separate from lists/mutation responses. */
export function getSignedDpsXml(rawAccess: DpsJournalAccess, rawDraftId: unknown) {
  const access = { ...rawAccess, tenantId: requireUuid(rawAccess.tenantId) };
  const draftId = requireUuid(rawDraftId);
  return withDpsTransaction(access, false, async client => {
    await requireDraft(client, access, draftId);
    const stored = await findSignature(client, access, draftId, true);
    if (!stored || typeof stored.xml !== "string") throw notFound();
    return { ...metadata(stored), xml: stored.xml };
  });
}

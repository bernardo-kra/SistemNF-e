import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { allowedKeys, inputRecord, requireUuid } from "./customers.js";
import { ApiError, invalidInput, notFound } from "./errors.js";
import { withDpsTransaction, type DpsJournalAccess } from "./nfse-dps-journal.js";

type State = "dispatch_reserved" | "result_unknown" | "response_unverified";
type Reason = "reserved" | "transport_failure" | "deadline_elapsed" | "receipt_received";
type Event = { version: number; state: State; reason: Reason; http_status: number | null; response_sha256: string | null; actor_id: string; at: string };
type Row = {
  id: string; tenant_id: string; signature_id: string; draft_id: string; dps_id: string; xml_sha256: string;
  state: State; version: number; reason: Reason; http_status: number | null; response_sha256: string | null;
  created_by: string; updated_by: string; created_at: Date; updated_at: Date; expires_at: Date; events: Event[];
};
type Outcome = {
  requestId: string; attemptId: string; version: number; phase: "submission" | "lookup";
  outcome: "result_unknown" | "response_unverified"; httpStatus?: number; responseSha256?: string;
};
const columns = "a.id,a.tenant_id,a.signature_id,a.draft_id,a.dps_id,a.xml_sha256,a.state,a.version,a.reason,a.http_status,a.response_sha256,a.created_by,a.updated_by,a.created_at,a.updated_at,a.expires_at";
const conflict = () => new ApiError(409, "DPS_SUBMISSION_CONFLICT", "A tentativa requer consulta. Nenhum reenvio ou novo número foi autorizado.");
const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function expectedVersion(raw: unknown) {
  if (!Number.isSafeInteger(raw) || Number(raw) < 1 || Number(raw) > 3) throw invalidInput();
  return raw as number;
}

function outcomeCommand(raw: unknown): Outcome {
  const body = inputRecord(raw);
  allowedKeys(body, ["requestId", "attemptId", "version", "phase", "outcome", "httpStatus", "responseSha256"]);
  if (body.phase !== "submission" && body.phase !== "lookup") throw invalidInput();
  if (body.outcome !== "result_unknown" && body.outcome !== "response_unverified") throw invalidInput();
  const result: Outcome = { requestId: requireUuid(body.requestId), attemptId: requireUuid(body.attemptId), version: expectedVersion(body.version), phase: body.phase, outcome: body.outcome };
  if (body.outcome === "response_unverified") {
    if (!Number.isSafeInteger(body.httpStatus) || Number(body.httpStatus) < 200 || Number(body.httpStatus) > 599
      || typeof body.responseSha256 !== "string" || !/^[a-f0-9]{64}$/.test(body.responseSha256)) throw invalidInput();
    result.httpStatus = body.httpStatus as number; result.responseSha256 = body.responseSha256;
  } else if (body.httpStatus !== undefined || body.responseSha256 !== undefined) throw invalidInput();
  return result;
}

function metadata(row: Row) {
  return {
    id: row.id, tenantId: row.tenant_id, draftId: row.draft_id, signatureId: row.signature_id, dpsId: row.dps_id, xmlSha256: row.xml_sha256,
    environment: "production-restricted" as const, state: row.state, version: row.version,
    httpStatus: row.http_status, responseSha256: row.response_sha256,
    createdBy: row.created_by, updatedBy: row.updated_by,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), expiresAt: row.expires_at.toISOString(),
    readyForSubmission: false as const, officialAuthorization: false as const,
    events: row.events.map(event => ({ version: event.version, state: event.state, reason: event.reason, httpStatus: event.http_status,
      responseSha256: event.response_sha256, actorId: event.actor_id, at: new Date(event.at).toISOString() })),
  };
}

async function loadAttempt(client: PoolClient, access: DpsJournalAccess, id: string) {
  const row = (await client.query<Row>(`SELECT ${columns},COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.version)
    FROM nfse_dps_submission_events e WHERE e.tenant_id=a.tenant_id AND e.attempt_id=a.id),'[]'::jsonb) AS events
    FROM nfse_dps_submission_attempts a WHERE a.tenant_id=$1 AND a.id=$2`, [access.tenantId, id])).rows[0];
  if (!row) throw notFound();
  return row;
}

async function replay(client: PoolClient, access: DpsJournalAccess, requestId: string, command: string, digest: string) {
  const row = (await client.query("SELECT tenant_id,actor_id,command,fingerprint,attempt_id FROM nfse_dps_submission_requests WHERE id=$1", [requestId])).rows[0];
  if (!row) return null;
  if (row.tenant_id !== access.tenantId || row.actor_id !== access.actorId || row.command !== command || row.fingerprint !== digest) throw conflict();
  return loadAttempt(client, access, row.attempt_id);
}

async function link(client: PoolClient, access: DpsJournalAccess, requestId: string, command: string, digest: string, id: string) {
  await client.query("INSERT INTO nfse_dps_submission_requests(id,tenant_id,actor_id,command,fingerprint,attempt_id) VALUES($1,$2,$3,$4,$5,$6)", [requestId, access.tenantId, access.actorId, command, digest, id]);
}

async function appendEvent(client: PoolClient, access: DpsJournalAccess, row: Omit<Row, "events">) {
  await client.query(`INSERT INTO nfse_dps_submission_events(tenant_id,attempt_id,version,state,reason,http_status,response_sha256,actor_id,at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [access.tenantId, row.id, row.version, row.state, row.reason, row.http_status, row.response_sha256, access.actorId, row.updated_at]);
  await client.query(`INSERT INTO audit_events(id,tenant_id,actor_id,action,entity_type,entity_id,entity_version,at,field_names,after_values)
    VALUES($1,$2,$3,'nfse.dps.submission.record','nfse_dps_submission_attempt',$4,$5,$6,ARRAY['submissionState'],$7)`,
  [randomUUID(), access.tenantId, access.actorId, row.id, row.version, row.updated_at,
    JSON.stringify({ state: row.state, reason: row.reason, draftId: row.draft_id, officialAuthorization: false })]);
}

/** Internal coordination only: caller authorizes current access. No transport/custody/HTTP imports.
 * claimed means first reservation, never fiscal readiness or permission to transmit.
 * Commit before any future I/O. A lost return must recover, never claim again.
 */
export async function startDpsSubmission(rawAccess: DpsJournalAccess, raw: unknown) {
  const access = { ...rawAccess, tenantId: requireUuid(rawAccess.tenantId) };
  const body = inputRecord(raw); allowedKeys(body, ["requestId", "signatureId"]);
  const requestId = requireUuid(body.requestId), signatureId = requireUuid(body.signatureId), digest = fingerprint({ signatureId });
  return withDpsTransaction(access, true, async client => {
    const previous = await replay(client, access, requestId, "start", digest);
    if (previous) return { claimed: false, attempt: metadata(previous) };
    const existing = (await client.query("SELECT id FROM nfse_dps_submission_attempts WHERE tenant_id=$1 AND signature_id=$2", [access.tenantId, signatureId])).rows[0];
    if (existing) {
      await link(client, access, requestId, "start", digest, existing.id);
      return { claimed: false, attempt: metadata(await loadAttempt(client, access, existing.id)) };
    }
    // Immutable signed source only; never accept bytes/hash/DPS identity from a request.
    const source = (await client.query(`SELECT s.draft_id,s.xml_sha256,d.dps_id FROM nfse_dps_signatures s
      JOIN nfse_dps_drafts d ON d.tenant_id=s.tenant_id AND d.id=s.draft_id
      WHERE s.tenant_id=$1 AND s.id=$2 AND d.environment='production-restricted'`, [access.tenantId, signatureId])).rows[0];
    if (!source) throw notFound();
    const id = randomUUID();
    await client.query(`WITH clock AS(SELECT clock_timestamp() AS at)
      INSERT INTO nfse_dps_submission_attempts(id,tenant_id,signature_id,draft_id,dps_id,xml_sha256,state,version,reason,created_by,updated_by,created_at,updated_at,expires_at)
      SELECT $1,$2,$3,$4,$5,$6,'dispatch_reserved',1,'reserved',$7,$7,at,at,at+interval '2 minutes' FROM clock`,
    [id, access.tenantId, signatureId, source.draft_id, source.dps_id, source.xml_sha256, access.actorId]);
    await appendEvent(client, access, await loadAttempt(client, access, id));
    await link(client, access, requestId, "start", digest, id);
    return { claimed: true, attempt: metadata(await loadAttempt(client, access, id)) };
  });
}

/** Internal receipt metadata only. Raw response and native errors must never be passed here.
 * HTTP/hash are evidence of receipt, not of fiscal validity or authorization.
 */
export async function recordDpsSubmissionOutcome(rawAccess: DpsJournalAccess, raw: unknown) {
  const access = { ...rawAccess, tenantId: requireUuid(rawAccess.tenantId) };
  const body = outcomeCommand(raw), { requestId, ...intent } = body, digest = fingerprint(intent);
  return withDpsTransaction(access, true, async client => {
    const previous = await replay(client, access, requestId, "outcome", digest); if (previous) return metadata(previous);
    const current = await loadAttempt(client, access, body.attemptId);
    if (current.version !== body.version) throw conflict();
    if (body.phase === "submission" ? current.state !== "dispatch_reserved"
      : current.state !== "result_unknown" || body.outcome !== "response_unverified") throw conflict();
    const reason: Reason = body.outcome === "result_unknown" ? "transport_failure" : "receipt_received";
    await client.query(`UPDATE nfse_dps_submission_attempts SET state=$3,version=version+1,reason=$4,http_status=$5,response_sha256=$6,updated_by=$7,updated_at=clock_timestamp()
      WHERE tenant_id=$1 AND id=$2`, [access.tenantId, current.id, body.outcome, reason, body.httpStatus ?? null, body.responseSha256 ?? null, access.actorId]);
    await appendEvent(client, access, await loadAttempt(client, access, current.id));
    await link(client, access, requestId, "outcome", digest, current.id);
    return metadata(await loadAttempt(client, access, current.id));
  });
}

/** Explicit interrupted-worker recovery by DB clock. It never rearms an attempt. */
export async function recoverExpiredDpsSubmission(rawAccess: DpsJournalAccess, raw: unknown) {
  const access = { ...rawAccess, tenantId: requireUuid(rawAccess.tenantId) };
  const body = inputRecord(raw); allowedKeys(body, ["requestId", "attemptId", "version"]);
  const requestId = requireUuid(body.requestId), attemptId = requireUuid(body.attemptId), version = expectedVersion(body.version), digest = fingerprint({ attemptId, version });
  return withDpsTransaction(access, true, async client => {
    const previous = await replay(client, access, requestId, "recover", digest); if (previous) return metadata(previous);
    const current = await loadAttempt(client, access, attemptId);
    if (current.version !== version || current.state !== "dispatch_reserved") throw conflict();
    const updated = await client.query(`UPDATE nfse_dps_submission_attempts SET state='result_unknown',version=2,reason='deadline_elapsed',updated_by=$3,updated_at=clock_timestamp()
      WHERE tenant_id=$1 AND id=$2 AND expires_at<=clock_timestamp() RETURNING id`, [access.tenantId, attemptId, access.actorId]);
    if (!updated.rowCount) throw conflict();
    await appendEvent(client, access, await loadAttempt(client, access, attemptId));
    await link(client, access, requestId, "recover", digest, attemptId);
    return metadata(await loadAttempt(client, access, attemptId));
  });
}

/** Read-only status; expired reservations remain reserved until explicit recovery. */
export async function getDpsSubmission(rawAccess: DpsJournalAccess, rawId: unknown) {
  const access = { ...rawAccess, tenantId: requireUuid(rawAccess.tenantId) };
  const id = requireUuid(rawId);
  return withDpsTransaction(access, false, async client => metadata(await loadAttempt(client, access, id)));
}

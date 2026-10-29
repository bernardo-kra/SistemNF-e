import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import sharp from "sharp";
import { allowedKeys, inputRecord, requireUuid } from "./customers.js";
import { ApiError, conflict, invalidInput, notFound, unavailable } from "./errors.js";

type Asset = { bytes: Buffer; mimeType: "image/webp"; width: number; height: number };
type Access = { tenantId: string; tenantName: string; actorId: string; pool: Pool };
type Row = { version: number; background_opacity: number; logo: Buffer | null; logo_width: number | null; logo_height: number | null; background: Buffer | null; background_width: number | null; background_height: number | null; updated_at: Date; updated_by: string };
const metadataColumns = "version,background_opacity,logo_width,logo_height,background_width,background_height,updated_at,updated_by";
function number(value: unknown, min: number, max: number) { if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw invalidInput(); return value as number; }
function projection(row?: Omit<Row, "logo" | "background">) {
  if (!row) return { version: 0, backgroundOpacity: 10, logo: null, background: null, updatedAt: null, updatedBy: null };
  return { version: row.version, backgroundOpacity: row.background_opacity,
    logo: row.logo_width === null ? null : { mimeType: "image/webp", width: row.logo_width, height: row.logo_height },
    background: row.background_width === null ? null : { mimeType: "image/webp", width: row.background_width, height: row.background_height },
    updatedAt: row.updated_at.toISOString(), updatedBy: row.updated_by };
}
async function transaction<T>(pool: Pool, run: (client: PoolClient) => Promise<T>, readOnly = false): Promise<T> {
  let client: PoolClient | undefined;
  try { client = await pool.connect(); await client.query(readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN"); const result = await run(client); await client.query("COMMIT"); return result; }
  catch (error) { if (client) { try { await client.query("ROLLBACK"); } catch { /* Preserve controlled failure. */ } } if (error instanceof ApiError) throw error; throw unavailable(); }
  finally { client?.release(); }
}

function rejectAnimation(bytes: Buffer, mime: string) {
  // Check container chunks too: a decoder may expose only the first frame.
  if (mime === "png") {
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = bytes.readUInt32BE(offset), end = offset + length + 12;
      if (end > bytes.length) throw invalidInput("A imagem não é válida.");
      if (bytes.toString("ascii", offset + 4, offset + 8) === "acTL") throw invalidInput("Use uma imagem sem animação.");
      offset = end;
    }
  } else if (mime === "webp") {
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const kind = bytes.toString("ascii", offset, offset + 4), length = bytes.readUInt32LE(offset + 4), end = offset + 8 + length + (length % 2);
      if (end > bytes.length) throw invalidInput("A imagem não é válida.");
      if (kind === "ANIM" || kind === "ANMF") throw invalidInput("Use uma imagem sem animação.");
      offset = end;
    }
  }
}
async function normalize(raw: unknown, kind: "logo" | "background"): Promise<Asset | null> {
  if (raw === null) return null;
  if (typeof raw !== "string" || raw.length > 1_398_150) throw invalidInput("Envie PNG, JPG ou WebP de até 1 MB por imagem.");
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(raw);
  if (!match) throw invalidInput("Envie uma imagem PNG, JPG ou WebP válida.");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 1024 * 1024 || bytes.toString("base64") !== match[2]) throw invalidInput("Confira o arquivo de imagem e seu tamanho.");
  try {
    const decoder = sharp(bytes, { limitInputPixels: 12_000_000, failOn: "warning" });
    const metadata = await decoder.metadata();
    if (metadata.format !== match[1] || !metadata.width || !metadata.height || metadata.width * metadata.height > 12_000_000 || (metadata.pages ?? 1) !== 1) throw invalidInput("Use PNG, JPG ou WebP sem animação, com até 12 milhões de pixels.");
    rejectAnimation(bytes, match[1]);
    const output = await decoder.rotate().resize({ width: kind === "logo" ? 600 : 1200, height: kind === "logo" ? 300 : 1600, fit: "inside", withoutEnlargement: true }).webp({ quality: 90 }).toBuffer({ resolveWithObject: true });
    if (output.data.length > 512 * 1024) throw invalidInput("Reduza a imagem antes de enviar novamente.");
    return { bytes: output.data, mimeType: "image/webp", width: output.info.width, height: output.info.height };
  } catch (error) { if (error instanceof ApiError) throw error; throw invalidInput("Não foi possível ler esta imagem. Use PNG, JPG ou WebP válido."); }
}

export async function readBranding(pool: Pool) {
  return transaction(pool, async (client) => projection((await client.query(`SELECT ${metadataColumns} FROM company_branding WHERE singleton=true`)).rows[0]), true);
}
export async function saveBranding(access: Access, raw: unknown) {
  const body = inputRecord(raw); allowedKeys(body, ["requestId", "version", "logo", "background", "backgroundOpacity"]);
  const requestId = requireUuid(body.requestId), version = number(body.version, 0, 2_147_483_646);
  const fields = ["logo", "background", "backgroundOpacity"].filter((field) => Object.hasOwn(body, field));
  if (!fields.length) throw invalidInput();
  const opacity = body.backgroundOpacity === undefined ? undefined : number(body.backgroundOpacity, 0, 20);
  // Decode before borrowing a database connection/lock; all images must validate before any write.
  const [logo, background] = await Promise.all([Object.hasOwn(body, "logo") ? normalize(body.logo, "logo") : undefined, Object.hasOwn(body, "background") ? normalize(body.background, "background") : undefined]);
  const canonical = JSON.stringify({ version, ...Object.fromEntries(fields.sort().map((field) => [field, body[field]])) });
  const fingerprint = createHash("sha256").update(canonical).digest("hex");
  return transaction(access.pool, async (client) => {
    // Includes the first save, when there is no row to lock yet.
    await client.query("SELECT pg_advisory_xact_lock(739001)");
    const previous = (await client.query("SELECT actor_id,fingerprint FROM company_branding_requests WHERE id=$1", [requestId])).rows[0];
    const old = (await client.query<Row>(`SELECT ${metadataColumns},logo,background FROM company_branding WHERE singleton=true FOR UPDATE`)).rows[0];
    if (previous) { if (previous.actor_id !== access.actorId || previous.fingerprint !== fingerprint) throw conflict(); return projection(old); }
    if ((old?.version ?? 0) !== version) throw conflict();
    const nextLogo = logo === undefined ? old?.logo ?? null : logo?.bytes ?? null;
    const nextBackground = background === undefined ? old?.background ?? null : background?.bytes ?? null;
    const nextOpacity = opacity ?? old?.background_opacity ?? 10;
    const same = (a: Buffer | null | undefined, b: Buffer | null) => (!a && !b) || Boolean(a && b && a.equals(b));
    const changed = !same(old?.logo, nextLogo) || !same(old?.background, nextBackground) || nextOpacity !== (old?.background_opacity ?? 10);
    let result = projection(old);
    if (changed) {
      const logoWidth = logo === undefined ? old?.logo_width ?? null : logo?.width ?? null, logoHeight = logo === undefined ? old?.logo_height ?? null : logo?.height ?? null;
      const backgroundWidth = background === undefined ? old?.background_width ?? null : background?.width ?? null, backgroundHeight = background === undefined ? old?.background_height ?? null : background?.height ?? null;
      const saved = (await client.query(`INSERT INTO company_branding(singleton,version,logo,logo_width,logo_height,background,background_width,background_height,background_opacity,updated_at,updated_by)
        VALUES(true,$1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp(),$9) ON CONFLICT(singleton) DO UPDATE SET version=EXCLUDED.version,logo=EXCLUDED.logo,logo_width=EXCLUDED.logo_width,logo_height=EXCLUDED.logo_height,background=EXCLUDED.background,background_width=EXCLUDED.background_width,background_height=EXCLUDED.background_height,background_opacity=EXCLUDED.background_opacity,updated_at=EXCLUDED.updated_at,updated_by=EXCLUDED.updated_by RETURNING ${metadataColumns}`,
        [version + 1, nextLogo, logoWidth, logoHeight, nextBackground, backgroundWidth, backgroundHeight, nextOpacity, access.actorId])).rows[0];
      result = projection(saved);
      const auditValues = (row: ReturnType<typeof projection>) => ({ logoPresent: row.logo !== null, backgroundPresent: row.background !== null, backgroundOpacity: row.backgroundOpacity });
      await client.query("INSERT INTO audit_events(id,tenant_id,actor_id,action,entity_type,entity_id,entity_version,at,field_names,before_values,after_values) VALUES($1,$2,$3,'company.branding.update','company_branding',$2,$4,$5,$6,$7,$8)",
        [randomUUID(), access.tenantId, access.actorId, result.version, result.updatedAt, fields, JSON.stringify(auditValues(projection(old))), JSON.stringify(auditValues(result))]);
    }
    await client.query("INSERT INTO company_branding_requests(id,actor_id,fingerprint,version) VALUES($1,$2,$3,$4)", [requestId, access.actorId, fingerprint, result.version]);
    return result;
  });
}
export async function brandingAsset(pool: Pool, kind: unknown, rawQuery: unknown) {
  if (kind !== "logo" && kind !== "background") throw invalidInput();
  const query = inputRecord(rawQuery); allowedKeys(query, ["version"]);
  if (typeof query.version !== "string" || !/^\d+$/.test(query.version)) throw invalidInput();
  const version = number(Number(query.version), 0, 2_147_483_647);
  return transaction(pool, async (client) => {
    // kind is a closed enum, never a user-supplied SQL identifier.
    const row = (await client.query(`SELECT version,${kind} AS bytes FROM company_branding WHERE singleton=true`)).rows[0];
    if ((row?.version ?? 0) !== version) throw conflict();
    if (!row?.bytes) throw notFound();
    return row.bytes as Buffer;
  }, true);
}
export async function orderReceipt(access: Access, rawId: unknown) {
  const id = requireUuid(rawId);
  return transaction(access.pool, async (client) => {
    const row = (await client.query("SELECT id,body,version,created_at,updated_at FROM operational_records WHERE entity_type='order' AND id=$1", [id])).rows[0];
    if (!row) throw notFound();
    const branding = projection((await client.query(`SELECT ${metadataColumns} FROM company_branding WHERE singleton=true`)).rows[0]);
    const body = row.body;
    return { tenantId: access.tenantId, companyName: access.tenantName, generatedAt: new Date().toISOString(), order: {
      id: row.id, number: body.number, version: row.version, customerName: body.customerName, customerPhone: body.customerPhone ?? "", equipment: body.equipment,
      issue: body.issue, diagnosis: body.diagnosis, technicianName: body.technicianName, due: body.due, laborCents: body.laborCents, approved: body.approved, tested: body.tested, stage: body.stage,
      createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() }, branding };
  }, true);
}

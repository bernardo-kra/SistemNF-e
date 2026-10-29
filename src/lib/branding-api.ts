import { accessBase, accessRequest, AccessError } from "./access-api";
import { resolveApiOrigin } from "../../shared/api-origin.mjs";

export type BrandAsset = { mimeType: string; width: number; height: number };
export type Branding = { version: number; backgroundOpacity: number; logo: BrandAsset | null; background: BrandAsset | null; updatedAt: string | null; updatedBy: string | null };
export type ReceiptOrder = { id: string; number: number; version: number; customerName: string; customerPhone: string; equipment: string; issue: string; diagnosis: string; technicianName: string; due: string; laborCents: number; approved: boolean; tested: boolean; stage: string; createdAt: string; updatedAt: string };
export type OrderDocument = { tenantId: string; companyName: string; generatedAt: string; order: ReceiptOrder; branding: Branding };
export const brandingBase = (tenant: string) => `${accessBase(tenant)}/branding`;
export function checkedBranding(value: unknown): Branding {
  if (!value || typeof value !== "object") throw new AccessError(503);
  const data = value as Branding;
  if (!Number.isSafeInteger(data.version) || data.version < 0 || !Number.isInteger(data.backgroundOpacity) || data.backgroundOpacity < 0 || data.backgroundOpacity > 20) throw new AccessError(503);
  for (const item of [data.logo, data.background]) if (item !== null && (!item || item.mimeType !== "image/webp" || !Number.isInteger(item.width) || item.width < 1 || !Number.isInteger(item.height) || item.height < 1)) throw new AccessError(503);
  return data;
}
export async function readBranding(tenant: string, signal?: AbortSignal) {
  const result = await accessRequest<{ tenantId: string; branding: Branding }>(brandingBase(tenant), { signal });
  if (result.tenantId !== tenant) throw new AccessError(503);
  return checkedBranding(result.branding);
}
export function brandingAssetUrl(tenant: string, kind: "logo" | "background", version: number) {
  if (!Number.isSafeInteger(version) || version < 1) throw new AccessError(503);
  return `${resolveApiOrigin(process.env.NEXT_PUBLIC_API_URL, window.location.href)}${brandingBase(tenant)}/assets/${kind}?version=${version}`;
}
export async function downloadBrandAsset(tenant: string, kind: "logo" | "background", version: number, signal: AbortSignal) {
  let response: Response;
  try { response = await fetch(brandingAssetUrl(tenant, kind, version), { credentials: "include", cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) }); }
  catch (error) { if (signal.aborted) throw error; throw new AccessError(503); }
  if (!response.ok) throw new AccessError(response.status);
  if (response.headers.get("content-type")?.split(";")[0] !== "image/webp") throw new AccessError(503);
  const blob = await response.blob();
  if (blob.size === 0 || blob.size > 512 * 1024) throw new AccessError(503);
  const url = URL.createObjectURL(blob);
  try { await decodedImage(url, signal); return url; } catch (error) { URL.revokeObjectURL(url); throw error; }
}
export async function decodedImage(url: string, signal?: AbortSignal) {
  const img = new Image(); img.src = url;
  await img.decode();
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (!img.naturalWidth || !img.naturalHeight) throw new AccessError(503);
}

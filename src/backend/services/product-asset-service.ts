import type { ID, ProductAsset, ProductAssetRole, ProductAssetStatus } from "../../core/models";
import { DomainError, id, nowIso } from "../../core/utils";
import type { RuntimeWriteContext } from "../../infra/db/runtime-store";
import { currentOrganizationId, writeAudit } from "./runtime-audit-service";

export async function createProductAsset(writeContext: RuntimeWriteContext, input: {
  productId: ID;
  role: ProductAssetRole;
  storageKey: string;
  url: string;
  slideType?: string;
  mimeType?: string;
  status?: ProductAssetStatus;
  createdBy?: "user" | "agent";
  sortOrder?: number;
  meta?: Record<string, unknown>;
}): Promise<ProductAsset> {
  const organizationId = currentOrganizationId(writeContext);
  const product = await writeContext.repos.products.getById(input.productId);
  if (!product) throw new DomainError("product_not_found", "Товар не найден");
  const existing = (await writeContext.repos.productAssets.all()).filter((asset) => asset.productId === product.id);
  const sortOrder = input.sortOrder ?? existing.reduce((max, asset) => Math.max(max, asset.sortOrder + 1), 0);
  const asset: ProductAsset = {
    id: id("asset"),
    organizationId,
    productId: product.id,
    role: input.role,
    slideType: input.slideType,
    storageKey: input.storageKey,
    url: input.url,
    mimeType: input.mimeType,
    sortOrder,
    status: input.status ?? "pending",
    createdBy: input.createdBy ?? "user",
    createdAt: nowIso(),
    meta: input.meta
  };
  await writeContext.repos.productAssets.add(asset);
  await writeAudit(writeContext, "product_asset", asset.id, "create", undefined, asset);
  return asset;
}

export async function confirmProductAsset(
  writeContext: RuntimeWriteContext,
  assetId: ID,
  patch: { width?: number; height?: number; mimeType?: string } = {}
): Promise<ProductAsset> {
  const asset = await writeContext.repos.productAssets.getById(assetId);
  if (!asset) throw new DomainError("product_asset_not_found", "Медиа не найдено");
  const before = { ...asset };
  asset.status = "ready";
  if (patch.width !== undefined) asset.width = patch.width;
  if (patch.height !== undefined) asset.height = patch.height;
  if (patch.mimeType) asset.mimeType = patch.mimeType;
  asset.updatedAt = nowIso();
  await writeContext.repos.productAssets.upsert(asset);
  await writeAudit(writeContext, "product_asset", asset.id, "confirm", before, asset);
  return asset;
}

export async function updateProductAsset(
  writeContext: RuntimeWriteContext,
  assetId: ID,
  patch: { role?: ProductAssetRole; status?: ProductAssetStatus; slideType?: string; sortOrder?: number; meta?: Record<string, unknown> }
): Promise<ProductAsset> {
  const asset = await writeContext.repos.productAssets.getById(assetId);
  if (!asset) throw new DomainError("product_asset_not_found", "Медиа не найдено");
  const before = { ...asset };
  if (patch.role) asset.role = patch.role;
  if (patch.status) asset.status = patch.status;
  if (patch.slideType !== undefined) asset.slideType = patch.slideType;
  if (patch.sortOrder !== undefined) asset.sortOrder = patch.sortOrder;
  if (patch.meta) asset.meta = { ...(asset.meta ?? {}), ...patch.meta };
  asset.updatedAt = nowIso();
  await writeContext.repos.productAssets.upsert(asset);
  await writeAudit(writeContext, "product_asset", asset.id, "update", before, asset);
  return asset;
}

export async function deleteProductAsset(writeContext: RuntimeWriteContext, assetId: ID): Promise<{ id: ID; deleted: true }> {
  const asset = await writeContext.repos.productAssets.getById(assetId);
  if (!asset) throw new DomainError("product_asset_not_found", "Медиа не найдено");
  await writeContext.repos.productAssets.removeById(asset.id);
  await writeAudit(writeContext, "product_asset", asset.id, "delete", asset, undefined);
  return { id: asset.id, deleted: true };
}

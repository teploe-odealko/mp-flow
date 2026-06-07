import type { ID, Product } from "../../core/models";
import { DomainError, id, nowIso } from "../../core/utils";
import type { RuntimeWriteContext } from "../../infra/db/runtime-store";
import { currentOrganizationId, writeAudit } from "./runtime-audit-service";

export interface ProductInput {
  sku: string;
  name: string;
  unit?: string;
  barcode?: string;
  category?: string;
  brand?: string;
  description?: string;
  weightGrams?: number;
  lengthMm?: number;
  widthMm?: number;
  heightMm?: number;
  manufacturerArticle?: string;
  comment?: string;
  imageUrl?: string;
}

export async function createProduct(writeContext: RuntimeWriteContext, input: ProductInput): Promise<Product> {
  const organizationId = currentOrganizationId(writeContext);
  const products = await writeContext.repos.products.all();
  if (products.some((product) => product.organizationId === organizationId && product.sku === input.sku)) {
    throw new DomainError("duplicate_sku", "Товар с таким SKU уже есть");
  }
  const product: Product = {
    id: id("prod"),
    organizationId,
    sku: input.sku,
    name: input.name,
    unit: input.unit || "шт",
    barcode: input.barcode,
    category: input.category,
    brand: input.brand,
    description: input.description,
    weightGrams: input.weightGrams,
    lengthMm: input.lengthMm,
    widthMm: input.widthMm,
    heightMm: input.heightMm,
    manufacturerArticle: input.manufacturerArticle,
    comment: input.comment,
    imageUrl: input.imageUrl,
    status: "active",
    createdAt: nowIso()
  };
  await writeContext.repos.products.add(product);
  await writeAudit(writeContext, "product", product.id, "create", undefined, product);
  return product;
}

export async function updateProduct(writeContext: RuntimeWriteContext, productId: ID, input: Partial<ProductInput>): Promise<Product> {
  const organizationId = currentOrganizationId(writeContext);
  const products = await writeContext.repos.products.all();
  const product = products.find((candidate) => candidate.id === productId);
  if (!product) throw new DomainError("product_not_found", "Товар не найден");
  const before = { ...product };
  if (input.sku && input.sku !== product.sku) {
    if (products.some((candidate) => candidate.organizationId === organizationId && candidate.id !== product.id && candidate.sku === input.sku)) {
      throw new DomainError("duplicate_sku", "Товар с таким SKU уже есть");
    }
    product.sku = input.sku;
  }
  if (input.name !== undefined) product.name = input.name;
  if (input.unit !== undefined) product.unit = input.unit || "шт";
  if (input.barcode !== undefined) product.barcode = input.barcode || undefined;
  if (input.category !== undefined) product.category = input.category || undefined;
  if (input.brand !== undefined) product.brand = input.brand || undefined;
  if (input.description !== undefined) product.description = input.description || undefined;
  if (input.weightGrams !== undefined) product.weightGrams = input.weightGrams;
  if (input.lengthMm !== undefined) product.lengthMm = input.lengthMm;
  if (input.widthMm !== undefined) product.widthMm = input.widthMm;
  if (input.heightMm !== undefined) product.heightMm = input.heightMm;
  if (input.manufacturerArticle !== undefined) product.manufacturerArticle = input.manufacturerArticle || undefined;
  if (input.comment !== undefined) product.comment = input.comment || undefined;
  if (input.imageUrl !== undefined) product.imageUrl = input.imageUrl || undefined;
  await writeContext.repos.products.upsert(product);
  await writeAudit(writeContext, "product", product.id, "update", before, product);
  return product;
}

export async function archiveProduct(writeContext: RuntimeWriteContext, productId: ID): Promise<Product> {
  return await setProductStatus(writeContext, productId, "archived", "archive");
}

export async function restoreProduct(writeContext: RuntimeWriteContext, productId: ID): Promise<Product> {
  return await setProductStatus(writeContext, productId, "active", "restore");
}

async function setProductStatus(
  writeContext: RuntimeWriteContext,
  productId: ID,
  status: Product["status"],
  eventType: "archive" | "restore"
) {
  const product = await writeContext.repos.products.getById(productId);
  if (!product) throw new DomainError("product_not_found", "Товар не найден");
  const before = { ...product };
  product.status = status;
  await writeContext.repos.products.upsert(product);
  await writeAudit(writeContext, "product", product.id, eventType, before, product);
  return product;
}

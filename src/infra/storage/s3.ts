import { randomUUID } from "node:crypto";
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * S3-совместимое хранилище медиа фотостудии (Timeweb Cloud по умолчанию).
 * Загрузка идёт presigned-PUT: байты летят напрямую агентом/браузером в бакет,
 * минуя наш бэкенд. Объекты в префиксе media/ — public-read, чтобы Ozon мог
 * скачать фото по URL при экспорте.
 */

interface StorageConfig {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBase: string;
  prefix: string;
}

let cachedConfig: StorageConfig | null | undefined;
let cachedClient: S3Client | undefined;

function readConfig(): StorageConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;
  const endpoint = process.env.S3_ENDPOINT?.trim();
  const bucket = process.env.S3_BUCKET?.trim();
  const accessKeyId = process.env.S3_ACCESS_KEY?.trim();
  const secretAccessKey = process.env.S3_SECRET_KEY?.trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    cachedConfig = null;
    return null;
  }
  const normalizedEndpoint = endpoint.replace(/\/+$/, "");
  cachedConfig = {
    endpoint: normalizedEndpoint,
    bucket,
    region: process.env.S3_REGION?.trim() || "ru-1",
    accessKeyId,
    secretAccessKey,
    publicBase: (process.env.S3_PUBLIC_BASE_URL?.trim() || `${normalizedEndpoint}/${bucket}`).replace(/\/+$/, ""),
    prefix: (process.env.S3_MEDIA_PREFIX?.trim() || "media").replace(/^\/+|\/+$/g, "")
  };
  return cachedConfig;
}

export function isStorageConfigured(): boolean {
  return readConfig() !== null;
}

function requireConfig(): StorageConfig {
  const config = readConfig();
  if (!config) {
    throw new Error("S3 не настроен: задайте S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY/S3_SECRET_KEY");
  }
  return config;
}

function client(config: StorageConfig): S3Client {
  if (!cachedClient) {
    cachedClient = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
    });
  }
  return cachedClient;
}

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif"
};

export function extensionForContentType(contentType: string | undefined): string {
  if (!contentType) return "png";
  return EXTENSION_BY_TYPE[contentType.toLowerCase()] ?? "bin";
}

export function isAllowedImageType(contentType: string | undefined): boolean {
  return Boolean(contentType && contentType.toLowerCase() in EXTENSION_BY_TYPE);
}

/** Строит ключ объекта: media/products/<productId>/<role>/<uuid>.<ext>. */
export function buildMediaKey(input: { productId: string; role: string; contentType?: string }): string {
  const config = requireConfig();
  const ext = extensionForContentType(input.contentType);
  const safeRole = input.role.replace(/[^a-z0-9_-]/gi, "").toLowerCase() || "asset";
  return `${config.prefix}/products/${input.productId}/${safeRole}/${randomUUID()}.${ext}`;
}

export function publicUrlForKey(key: string): string {
  const config = requireConfig();
  return `${config.publicBase}/${key.replace(/^\/+/, "")}`;
}

/** Presigned-PUT URL для прямой загрузки байтов в бакет. */
export async function createPresignedUpload(input: {
  key: string;
  contentType: string;
  expiresIn?: number;
}): Promise<{ uploadUrl: string; publicUrl: string }> {
  const config = requireConfig();
  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: input.key,
    ContentType: input.contentType,
    ACL: "public-read"
  });
  const uploadUrl = await getSignedUrl(client(config), command, { expiresIn: input.expiresIn ?? 900 });
  return { uploadUrl, publicUrl: publicUrlForKey(input.key) };
}

/** Проверяет, что объект реально загружен (вызывается на confirm). */
export async function headObject(key: string): Promise<{ size?: number; contentType?: string } | null> {
  const config = requireConfig();
  try {
    const result = await client(config).send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
    return { size: result.ContentLength, contentType: result.ContentType };
  } catch {
    return null;
  }
}

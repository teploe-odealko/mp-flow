import type { EntityManager } from "@mikro-orm/core"
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { v4 } from "uuid"
import { FileAsset } from "./entity.js"

interface S3Config {
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  region?: string
  forcePathStyle?: boolean
}

let s3Client: S3Client | null = null
let s3Bucket: string = "mpflow"

export class FileStorageService {
  constructor(private em: EntityManager) {}

  /**
   * Configure S3 client (call once at server startup)
   */
  static configure(config: S3Config) {
    s3Client = new S3Client({
      endpoint: config.endpoint,
      region: config.region || "us-east-1",
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle ?? true,
    })
    s3Bucket = config.bucket
    console.log(`[mpflow] S3 configured: ${config.endpoint}/${config.bucket}`)
  }

  static isConfigured(): boolean {
    return s3Client !== null
  }

  private getClient(): S3Client {
    if (!s3Client) throw new Error("S3 not configured. Set S3_ENDPOINT env var.")
    return s3Client
  }

  /**
   * Check if user has quota for the given size
   */
  async checkQuota(userId: string, sizeBytes: number): Promise<boolean> {
    const conn = this.em.getConnection()
    const result = await conn.execute(
      `SELECT storage_quota_mb FROM mpflow_user WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
      [userId],
    )
    if (result.length === 0) return false

    const quotaMb = result[0].storage_quota_mb
    // NULL = unlimited (self-hosted)
    if (quotaMb === null) return true
    // 0 = no uploads
    if (quotaMb === 0) return false

    const quotaBytes = quotaMb * 1024 * 1024
    const usage = await this.getUsageBytes(userId)
    return usage + sizeBytes <= quotaBytes
  }

  /**
   * Get storage usage in bytes
   */
  private async getUsageBytes(userId: string): Promise<number> {
    const conn = this.em.getConnection()
    const result = await conn.execute(
      `SELECT COALESCE(SUM(size_bytes), 0)::bigint as used FROM file_asset WHERE user_id = ? AND deleted_at IS NULL`,
      [userId],
    )
    return Number(result[0]?.used ?? 0)
  }

  /**
   * Get usage summary
   */
  async getUsage(userId: string): Promise<{ used_bytes: number; quota_bytes: number | null; file_count: number }> {
    const conn = this.em.getConnection()
    const [usageResult, quotaResult] = await Promise.all([
      conn.execute(
        `SELECT COALESCE(SUM(size_bytes), 0)::bigint as used, COUNT(*)::int as count FROM file_asset WHERE user_id = ? AND deleted_at IS NULL`,
        [userId],
      ),
      conn.execute(
        `SELECT storage_quota_mb FROM mpflow_user WHERE id = ? AND deleted_at IS NULL LIMIT 1`,
        [userId],
      ),
    ])

    const quotaMb = quotaResult[0]?.storage_quota_mb
    return {
      used_bytes: Number(usageResult[0]?.used ?? 0),
      quota_bytes: quotaMb === null ? null : (quotaMb ?? 0) * 1024 * 1024,
      file_count: usageResult[0]?.count ?? 0,
    }
  }

  /**
   * Upload file from base64 (for MCP agents)
   */
  async uploadBase64(
    userId: string,
    params: {
      filename: string
      mimeType: string
      base64Data: string
      metadata?: Record<string, any>
    },
  ): Promise<FileAsset> {
    const buffer = Buffer.from(params.base64Data, "base64")
    return this.upload(userId, {
      filename: params.filename,
      mimeType: params.mimeType,
      body: buffer,
      sizeBytes: buffer.length,
      metadata: params.metadata,
    })
  }

  /**
   * Upload file
   */
  async upload(
    userId: string,
    params: {
      filename: string
      mimeType: string
      body: Buffer | Uint8Array
      sizeBytes: number
      metadata?: Record<string, any>
    },
  ): Promise<FileAsset> {
    const canUpload = await this.checkQuota(userId, params.sizeBytes)
    if (!canUpload) {
      throw new Error("Storage quota exceeded")
    }

    const fileId = v4()
    const s3Key = `users/${userId}/${fileId}-${params.filename}`

    await this.getClient().send(
      new PutObjectCommand({
        Bucket: s3Bucket,
        Key: s3Key,
        Body: params.body,
        ContentType: params.mimeType,
      }),
    )

    const asset = this.em.create(FileAsset, {
      id: fileId,
      user_id: userId,
      filename: params.filename,
      mime_type: params.mimeType,
      size_bytes: params.sizeBytes,
      s3_key: s3Key,
      s3_bucket: s3Bucket,
      metadata: params.metadata || null,
    } as any)
    await this.em.persistAndFlush(asset)

    return asset
  }

  /**
   * Get file by ID (checks user ownership)
   */
  async getById(userId: string, fileId: string): Promise<FileAsset | null> {
    return this.em.findOne(FileAsset, { id: fileId, user_id: userId, deleted_at: null })
  }

  /**
   * Get presigned download URL (1 hour)
   */
  async getSignedUrl(userId: string, fileId: string): Promise<string> {
    const asset = await this.getById(userId, fileId)
    if (!asset) throw new Error("File not found")

    const command = new GetObjectCommand({
      Bucket: asset.s3_bucket || s3Bucket,
      Key: asset.s3_key,
    })
    return getSignedUrl(this.getClient(), command, { expiresIn: 3600 })
  }

  /**
   * Download file content
   */
  async download(userId: string, fileId: string): Promise<{ stream: ReadableStream; contentType: string; filename: string }> {
    const asset = await this.getById(userId, fileId)
    if (!asset) throw new Error("File not found")

    const response = await this.getClient().send(
      new GetObjectCommand({
        Bucket: asset.s3_bucket || s3Bucket,
        Key: asset.s3_key,
      }),
    )

    return {
      stream: response.Body as unknown as ReadableStream,
      contentType: asset.mime_type,
      filename: asset.filename,
    }
  }

  /**
   * List files for user
   */
  async list(
    userId: string,
    params?: { source?: string; limit?: number; offset?: number },
  ): Promise<{ files: FileAsset[]; total: number }> {
    const where: Record<string, any> = { user_id: userId, deleted_at: null }

    if (params?.source) {
      where.metadata = { source: params.source }
    }

    const [files, total] = await Promise.all([
      this.em.find(FileAsset, where, {
        orderBy: { created_at: "DESC" },
        limit: params?.limit || 50,
        offset: params?.offset || 0,
      }),
      this.em.count(FileAsset, where),
    ])

    return { files, total }
  }

  /**
   * Soft delete file
   */
  async delete(userId: string, fileId: string): Promise<void> {
    const asset = await this.getById(userId, fileId)
    if (!asset) throw new Error("File not found")
    asset.deleted_at = new Date()
    await this.em.flush()
  }
}

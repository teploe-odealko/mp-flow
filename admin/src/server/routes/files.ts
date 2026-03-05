import { Hono } from "hono"
import { getUserId } from "../core/auth.js"
import type { FileStorageService } from "../modules/file-storage/service.js"

const files = new Hono<{ Variables: Record<string, any> }>()

// POST /api/files/upload-base64 — JSON upload (for MCP agents)
files.post("/upload-base64", async (c) => {
  const userId = getUserId(c)
  const { base64_data, filename, mime_type, metadata } = await c.req.json()

  if (!base64_data || !filename || !mime_type) {
    return c.json({ error: "base64_data, filename, and mime_type are required" }, 400)
  }

  const service: FileStorageService = c.get("container").resolve("fileStorageService")
  try {
    const file = await service.uploadBase64(userId, {
      filename,
      mimeType: mime_type,
      base64Data: base64_data,
      metadata,
    })
    return c.json({ file }, 201)
  } catch (e: any) {
    if (e.message === "Storage quota exceeded") {
      return c.json({ error: "Storage quota exceeded" }, 413)
    }
    throw e
  }
})

// POST /api/files/upload — multipart upload
files.post("/upload", async (c) => {
  const userId = getUserId(c)
  const formData = await c.req.formData()
  const file = formData.get("file") as File | null
  const metadataStr = formData.get("metadata") as string | null

  if (!file) {
    return c.json({ error: "file is required" }, 400)
  }

  const metadata = metadataStr ? JSON.parse(metadataStr) : undefined
  const buffer = Buffer.from(await file.arrayBuffer())

  const service: FileStorageService = c.get("container").resolve("fileStorageService")
  try {
    const asset = await service.upload(userId, {
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      body: buffer,
      sizeBytes: buffer.length,
      metadata,
    })
    return c.json({ file: asset }, 201)
  } catch (e: any) {
    if (e.message === "Storage quota exceeded") {
      return c.json({ error: "Storage quota exceeded" }, 413)
    }
    throw e
  }
})

// GET /api/files — list files
files.get("/", async (c) => {
  const userId = getUserId(c)
  const { limit = "50", offset = "0", source } = c.req.query()

  const service: FileStorageService = c.get("container").resolve("fileStorageService")
  const result = await service.list(userId, {
    source,
    limit: Number(limit),
    offset: Number(offset),
  })
  return c.json(result)
})

// GET /api/files/usage — storage usage
files.get("/usage", async (c) => {
  const userId = getUserId(c)
  const service: FileStorageService = c.get("container").resolve("fileStorageService")
  const usage = await service.getUsage(userId)
  return c.json(usage)
})

// GET /api/files/:id — file metadata
files.get("/:id", async (c) => {
  const userId = getUserId(c)
  const { id } = c.req.param()
  const service: FileStorageService = c.get("container").resolve("fileStorageService")
  const file = await service.getById(userId, id)
  if (!file) return c.json({ error: "Not found" }, 404)
  return c.json({ file })
})

// GET /api/files/:id/url — signed URL
files.get("/:id/url", async (c) => {
  const userId = getUserId(c)
  const { id } = c.req.param()
  const service: FileStorageService = c.get("container").resolve("fileStorageService")
  try {
    const url = await service.getSignedUrl(userId, id)
    return c.json({ url })
  } catch (e: any) {
    return c.json({ error: e.message }, 404)
  }
})

// GET /api/files/:id/download — proxied download
files.get("/:id/download", async (c) => {
  const userId = getUserId(c)
  const { id } = c.req.param()
  const service: FileStorageService = c.get("container").resolve("fileStorageService")
  try {
    const { stream, contentType, filename } = await service.download(userId, id)
    const safeFilename = encodeURIComponent(filename)
    return new Response(stream, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename*=UTF-8''${safeFilename}`,
        "Cache-Control": "private, max-age=3600",
      },
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 404)
  }
})

// DELETE /api/files/:id — soft delete
files.delete("/:id", async (c) => {
  const userId = getUserId(c)
  const { id } = c.req.param()
  const service: FileStorageService = c.get("container").resolve("fileStorageService")
  try {
    await service.delete(userId, id)
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 404)
  }
})

export default files

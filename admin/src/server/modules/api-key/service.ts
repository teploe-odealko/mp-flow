import type { EntityManager } from "@mikro-orm/core"
import { createHash, randomBytes } from "node:crypto"
import { ApiKey } from "./entity.js"

function hashKey(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export class ApiKeyService {
  constructor(private em: EntityManager) {}

  async create(userId: string, name: string): Promise<{ id: string; name: string; key: string; key_prefix: string }> {
    const raw = randomBytes(16).toString("hex") // 32 hex chars
    const token = `mpf_${raw}`
    const prefix = token.slice(0, 8)

    const apiKey = this.em.create(ApiKey, {
      user_id: userId,
      name,
      key_prefix: prefix,
      key_hash: hashKey(token),
    } as any)
    await this.em.persistAndFlush(apiKey)

    return { id: apiKey.id, name: apiKey.name, key: token, key_prefix: prefix }
  }

  async list(userId: string): Promise<ApiKey[]> {
    return this.em.find(ApiKey, { user_id: userId, revoked_at: null }, { orderBy: { created_at: "DESC" } })
  }

  async revoke(id: string, userId: string): Promise<boolean> {
    const key = await this.em.findOne(ApiKey, { id, user_id: userId, revoked_at: null })
    if (!key) return false
    key.revoked_at = new Date()
    await this.em.flush()
    return true
  }

  async validateKey(token: string): Promise<{ user_id: string } | null> {
    const hash = hashKey(token)
    const key = await this.em.findOne(ApiKey, { key_hash: hash, revoked_at: null })
    if (!key) return null
    key.last_used_at = new Date()
    await this.em.flush()
    return { user_id: key.user_id }
  }
}

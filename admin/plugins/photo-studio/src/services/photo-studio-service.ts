import type { EntityManager } from "@mikro-orm/core"
import { PhotoProject, type PhotoFrame, type PhotoResearch } from "../entities/photo-project.js"

export class PhotoStudioService {
  constructor(private em: EntityManager) {}

  async listProjects(userId: string, filters?: { master_card_id?: string; status?: string }) {
    const where: Record<string, any> = { user_id: userId }
    if (filters?.master_card_id) where.master_card_id = filters.master_card_id
    if (filters?.status) where.status = filters.status
    return this.em.find(PhotoProject, where, { orderBy: { created_at: "DESC" } })
  }

  async getProject(userId: string, projectId: string): Promise<PhotoProject> {
    return this.em.findOneOrFail(PhotoProject, { id: projectId, user_id: userId })
  }

  async createProject(userId: string, masterCardId: string): Promise<PhotoProject> {
    const project = this.em.create(PhotoProject, {
      user_id: userId,
      master_card_id: masterCardId,
      status: "draft",
      frames: [],
      total_frames: 0,
      approved_frames: 0,
      generated_frames: 0,
    } as any)
    await this.em.persistAndFlush(project)
    return project
  }

  async deleteProject(userId: string, projectId: string): Promise<void> {
    const project = await this.getProject(userId, projectId)
    await this.em.removeAndFlush(project)
  }

  // ── Stage 1: Research & Planning ──

  async saveResearch(userId: string, projectId: string, data: PhotoResearch): Promise<PhotoProject> {
    const project = await this.getProject(userId, projectId)
    project.research = data
    await this.em.flush()
    return project
  }

  async savePlan(userId: string, projectId: string, concepts: Array<{ concept: string; source_images?: string[] }>): Promise<PhotoProject> {
    const project = await this.getProject(userId, projectId)
    project.frames = concepts.map((c, i) => ({
      index: i,
      concept: c.concept,
      source_images: c.source_images,
      status: "concept" as const,
      attempts: 0,
    }))
    project.total_frames = concepts.length
    project.status = "planned"
    await this.em.flush()
    return project
  }

  // ── Stage 2: SVG Preview ──

  async saveFrameSvg(userId: string, projectId: string, frameIndex: number, svgContent: string): Promise<PhotoProject> {
    const project = await this.getProject(userId, projectId)
    const frame = project.frames[frameIndex]
    if (!frame) throw new Error(`Frame ${frameIndex} not found`)

    frame.svg_content = svgContent
    frame.status = "svg_draft"
    frame.svg_feedback = undefined

    if (project.status === "planned") project.status = "svg_review"
    await this.em.flush()
    return project
  }

  async approveFrame(userId: string, projectId: string, frameIndex: number): Promise<PhotoProject> {
    const project = await this.getProject(userId, projectId)
    const frame = project.frames[frameIndex]
    if (!frame) throw new Error(`Frame ${frameIndex} not found`)

    frame.status = "svg_approved"
    frame.svg_feedback = undefined
    project.approved_frames = project.frames.filter((f) => f.status === "svg_approved" || f.status === "generating" || f.status === "generated").length
    await this.em.flush()
    return project
  }

  async feedbackFrame(userId: string, projectId: string, frameIndex: number, feedback: string): Promise<PhotoProject> {
    const project = await this.getProject(userId, projectId)
    const frame = project.frames[frameIndex]
    if (!frame) throw new Error(`Frame ${frameIndex} not found`)

    frame.svg_feedback = feedback
    frame.status = "svg_draft"
    await this.em.flush()
    return project
  }

  // ── Stage 3: Generation ──

  async markFrameGenerating(userId: string, projectId: string, frameIndex: number, prompt: string): Promise<PhotoProject> {
    const project = await this.getProject(userId, projectId)
    const frame = project.frames[frameIndex]
    if (!frame) throw new Error(`Frame ${frameIndex} not found`)

    frame.status = "generating"
    frame.generation_prompt = prompt
    frame.attempts++

    if (project.status !== "generating") project.status = "generating"
    await this.em.flush()
    return project
  }

  async saveGenerated(userId: string, projectId: string, frameIndex: number, fileId: string): Promise<PhotoProject> {
    const project = await this.getProject(userId, projectId)
    const frame = project.frames[frameIndex]
    if (!frame) throw new Error(`Frame ${frameIndex} not found`)

    frame.status = "generated"
    frame.generated_file_id = fileId
    project.generated_frames = project.frames.filter((f) => f.status === "generated").length

    // Check if all frames are generated
    if (project.generated_frames === project.total_frames) {
      project.status = "completed"
    }
    await this.em.flush()
    return project
  }

  async markFrameFailed(userId: string, projectId: string, frameIndex: number, error: string): Promise<PhotoProject> {
    const project = await this.getProject(userId, projectId)
    const frame = project.frames[frameIndex]
    if (!frame) throw new Error(`Frame ${frameIndex} not found`)

    frame.status = "failed"
    project.error = error
    await this.em.flush()
    return project
  }

  async requestRegeneration(userId: string, projectId: string, frameIndex: number, feedback: string): Promise<PhotoProject> {
    const project = await this.getProject(userId, projectId)
    const frame = project.frames[frameIndex]
    if (!frame) throw new Error(`Frame ${frameIndex} not found`)

    frame.generation_feedback = feedback
    frame.status = "svg_approved"
    frame.generated_file_id = undefined
    project.generated_frames = project.frames.filter((f) => f.status === "generated").length

    if (project.status === "completed") project.status = "generating"
    await this.em.flush()
    return project
  }

  // ── Context aggregation ──

  async getContext(userId: string, masterCardId: string, container: any): Promise<Record<string, any>> {
    const context: Record<string, any> = {}

    // Master card data
    try {
      const masterCardService = container.resolve("masterCardService")
      const card = await masterCardService.retrieve(masterCardId)
      if (card.user_id && card.user_id !== userId) throw new Error("Access denied")
      context.product = {
        id: card.id,
        title: card.title,
        description: card.description,
        thumbnail: card.thumbnail,
        purchase_price: card.purchase_price,
        metadata: card.metadata,
      }
    } catch {
      context.product = null
    }

    // Ozon data (optional plugin)
    try {
      const ozonService = container.resolve("ozonSyncService")
      const conn = this.em.getConnection()
      // Find Ozon product link
      const links = await conn.execute(
        `SELECT ozon_product_id, images, ozon_data FROM ozon_product_link WHERE master_card_id = ? AND deleted_at IS NULL LIMIT 1`,
        [masterCardId],
      )
      if (links.length > 0) {
        context.ozon = {
          product_id: links[0].ozon_product_id,
          images: links[0].images || [],
          attributes: links[0].ozon_data || {},
        }
      }
    } catch {
      // Ozon plugin not loaded — skip
    }

    // Ali1688 data (optional plugin)
    try {
      const conn = this.em.getConnection()
      const links = await conn.execute(
        `SELECT ali_url, images, ali_data FROM ali1688_product_link WHERE master_card_id = ? AND deleted_at IS NULL LIMIT 1`,
        [masterCardId],
      )
      if (links.length > 0) {
        context.ali1688 = {
          url: links[0].ali_url,
          images: links[0].images || [],
          data: links[0].ali_data || {},
        }
      }
    } catch {
      // Ali1688 plugin not loaded — skip
    }

    // Existing photo projects
    const projects = await this.listProjects(userId, { master_card_id: masterCardId })
    context.existing_projects = projects.map((p) => ({
      id: p.id,
      status: p.status,
      total_frames: p.total_frames,
      generated_frames: p.generated_frames,
    }))

    return context
  }
}

import { Hono } from "hono"
import { getUserId } from "../../../../src/server/core/auth.js"
import type { PhotoStudioService } from "../services/photo-studio-service.js"

const photoStudio = new Hono<{ Variables: Record<string, any> }>()

// GET /api/photo-studio — list projects
photoStudio.get("/", async (c) => {
  const userId = getUserId(c)
  const { master_card_id, status } = c.req.query()
  const service: PhotoStudioService = c.get("container").resolve("photoStudioService")
  const projects = await service.listProjects(userId, { master_card_id: master_card_id, status })
  return c.json({ projects })
})

// GET /api/photo-studio/context/:masterCardId — aggregate product context
photoStudio.get("/context/:masterCardId", async (c) => {
  const userId = getUserId(c)
  const { masterCardId } = c.req.param()
  const service: PhotoStudioService = c.get("container").resolve("photoStudioService")
  const container = c.get("container")
  const context = await service.getContext(userId, masterCardId, container)
  return c.json(context)
})

// GET /api/photo-studio/:id — get project with frames
photoStudio.get("/:id", async (c) => {
  const userId = getUserId(c)
  const { id } = c.req.param()
  const service: PhotoStudioService = c.get("container").resolve("photoStudioService")
  try {
    const project = await service.getProject(userId, id)
    return c.json({ project })
  } catch {
    return c.json({ error: "Not found" }, 404)
  }
})

// POST /api/photo-studio — create project
photoStudio.post("/", async (c) => {
  const userId = getUserId(c)
  const { master_card_id } = await c.req.json()
  if (!master_card_id) return c.json({ error: "master_card_id is required" }, 400)
  const service: PhotoStudioService = c.get("container").resolve("photoStudioService")
  const project = await service.createProject(userId, master_card_id)
  return c.json({ project }, 201)
})

// DELETE /api/photo-studio/:id
photoStudio.delete("/:id", async (c) => {
  const userId = getUserId(c)
  const { id } = c.req.param()
  const service: PhotoStudioService = c.get("container").resolve("photoStudioService")
  try {
    await service.deleteProject(userId, id)
    return c.json({ success: true })
  } catch {
    return c.json({ error: "Not found" }, 404)
  }
})

// POST /api/photo-studio/:id/research — save research
photoStudio.post("/:id/research", async (c) => {
  const userId = getUserId(c)
  const { id } = c.req.param()
  const data = await c.req.json()
  const service: PhotoStudioService = c.get("container").resolve("photoStudioService")
  const project = await service.saveResearch(userId, id, data)
  return c.json({ project })
})

// POST /api/photo-studio/:id/plan — save frame plan
photoStudio.post("/:id/plan", async (c) => {
  const userId = getUserId(c)
  const { id } = c.req.param()
  const { frames } = await c.req.json()
  if (!frames?.length) return c.json({ error: "frames array is required" }, 400)
  const service: PhotoStudioService = c.get("container").resolve("photoStudioService")
  const project = await service.savePlan(userId, id, frames)
  return c.json({ project })
})

// POST /api/photo-studio/:id/source-images — add source image
photoStudio.post("/:id/source-images", async (c) => {
  const userId = getUserId(c)
  const { id } = c.req.param()
  const { file_id } = await c.req.json()
  if (!file_id) return c.json({ error: "file_id is required" }, 400)
  const service: PhotoStudioService = c.get("container").resolve("photoStudioService")
  const project = await service.addSourceImage(userId, id, file_id)
  return c.json({ project })
})

// DELETE /api/photo-studio/:id/source-images/:fileId — remove source image
photoStudio.delete("/:id/source-images/:fileId", async (c) => {
  const userId = getUserId(c)
  const { id, fileId } = c.req.param()
  const service: PhotoStudioService = c.get("container").resolve("photoStudioService")
  const project = await service.removeSourceImage(userId, id, fileId)
  return c.json({ project })
})

// POST /api/photo-studio/:id/frames/:index/source-images — set frame source images
photoStudio.post("/:id/frames/:index/source-images", async (c) => {
  const userId = getUserId(c)
  const { id, index } = c.req.param()
  const { file_ids } = await c.req.json()
  if (!Array.isArray(file_ids)) return c.json({ error: "file_ids array is required" }, 400)
  const service: PhotoStudioService = c.get("container").resolve("photoStudioService")
  const project = await service.setFrameSourceImages(userId, id, Number(index), file_ids)
  return c.json({ project })
})

// POST /api/photo-studio/:id/style-config — save style config
photoStudio.post("/:id/style-config", async (c) => {
  const userId = getUserId(c)
  const { id } = c.req.param()
  const config = await c.req.json()
  const service: PhotoStudioService = c.get("container").resolve("photoStudioService")
  const project = await service.saveStyleConfig(userId, id, config)
  return c.json({ project })
})

// POST /api/photo-studio/:id/frames/:index/svg — save SVG preview
photoStudio.post("/:id/frames/:index/svg", async (c) => {
  const userId = getUserId(c)
  const { id, index } = c.req.param()
  const { svg_content } = await c.req.json()
  if (!svg_content) return c.json({ error: "svg_content is required" }, 400)
  const service: PhotoStudioService = c.get("container").resolve("photoStudioService")
  const project = await service.saveFrameSvg(userId, id, Number(index), svg_content)
  return c.json({ project })
})

// POST /api/photo-studio/:id/frames/:index/approve — approve SVG
photoStudio.post("/:id/frames/:index/approve", async (c) => {
  const userId = getUserId(c)
  const { id, index } = c.req.param()
  const service: PhotoStudioService = c.get("container").resolve("photoStudioService")
  const project = await service.approveFrame(userId, id, Number(index))
  return c.json({ project })
})

// POST /api/photo-studio/:id/frames/:index/feedback — feedback on SVG
photoStudio.post("/:id/frames/:index/feedback", async (c) => {
  const userId = getUserId(c)
  const { id, index } = c.req.param()
  const { feedback } = await c.req.json()
  if (!feedback) return c.json({ error: "feedback is required" }, 400)
  const service: PhotoStudioService = c.get("container").resolve("photoStudioService")
  const project = await service.feedbackFrame(userId, id, Number(index), feedback)
  return c.json({ project })
})

// POST /api/photo-studio/:id/frames/:index/generated — save generated file
photoStudio.post("/:id/frames/:index/generated", async (c) => {
  const userId = getUserId(c)
  const { id, index } = c.req.param()
  const { file_id } = await c.req.json()
  if (!file_id) return c.json({ error: "file_id is required" }, 400)
  const service: PhotoStudioService = c.get("container").resolve("photoStudioService")
  const project = await service.saveGenerated(userId, id, Number(index), file_id)
  return c.json({ project })
})

// POST /api/photo-studio/:id/frames/:index/regen — request regeneration
photoStudio.post("/:id/frames/:index/regen", async (c) => {
  const userId = getUserId(c)
  const { id, index } = c.req.param()
  const { feedback } = await c.req.json()
  if (!feedback) return c.json({ error: "feedback is required" }, 400)
  const service: PhotoStudioService = c.get("container").resolve("photoStudioService")
  const project = await service.requestRegeneration(userId, id, Number(index), feedback)
  return c.json({ project })
})

export default photoStudio

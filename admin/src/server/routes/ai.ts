import { Hono } from "hono"
import { getUserId } from "../core/auth.js"
import type { AiImageService } from "../modules/ai-image/service.js"

const ai = new Hono<{ Variables: Record<string, any> }>()

// POST /api/ai/generate-image
ai.post("/generate-image", async (c) => {
  const userId = getUserId(c)
  const { prompt, input_images, save, filename, metadata } = await c.req.json()

  if (!prompt) {
    return c.json({ error: "prompt is required" }, 400)
  }

  const service: AiImageService = c.get("container").resolve("aiImageService")

  try {
    const result = await service.generate({
      userId,
      prompt,
      inputImages: input_images,
      save: save ?? false,
      filename,
      metadata,
    })
    return c.json(result)
  } catch (e: any) {
    if (e.message.includes("Insufficient credits")) {
      return c.json({ error: e.message }, 402)
    }
    if (e.message.includes("not configured")) {
      return c.json({ error: e.message }, 503)
    }
    if (e.message.includes("Storage quota exceeded")) {
      return c.json({ error: e.message }, 413)
    }
    return c.json({ error: e.message }, 500)
  }
})

export default ai

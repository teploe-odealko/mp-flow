import type { EntityManager } from "@mikro-orm/core"
import { FileStorageService } from "../file-storage/service.js"
import type { CreditService } from "../credit/service.js"

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions"

interface GenerateParams {
  userId: string
  prompt: string
  inputImages?: string[]
  save?: boolean
  filename?: string
  metadata?: Record<string, any>
}

type GenerateResult =
  | { saved: true; file_id: string; url: string }
  | { saved: false; base64_data: string; mime_type: string }

export class AiImageService {
  constructor(
    private em: EntityManager,
    private creditService: CreditService,
    private fileStorageService: FileStorageService,
  ) {}

  async generate(params: GenerateParams): Promise<GenerateResult> {
    const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_API
    if (!apiKey) throw new Error("OPENROUTER_API_KEY not configured")

    const model = process.env.OPENROUTER_IMAGE_MODEL || "google/gemini-2.5-flash-preview-05-20"

    // Deduct 1 credit
    const deductResult = await this.creditService.deduct(
      params.userId,
      1,
      "core",
      "generate_image",
      `AI image: ${params.prompt.slice(0, 100)}`,
    )
    if (!deductResult.success) {
      throw new Error(`Insufficient credits. Balance: ${deductResult.balance}`)
    }

    try {
      // Build message content
      const content: any[] = [{ type: "text", text: params.prompt }]

      if (params.inputImages?.length) {
        for (const img of params.inputImages.slice(0, 14)) {
          if (img.startsWith("data:") || img.startsWith("http")) {
            content.push({
              type: "image_url",
              image_url: { url: img },
            })
          } else {
            // Assume base64 without data URI prefix
            content.push({
              type: "image_url",
              image_url: { url: `data:image/png;base64,${img}` },
            })
          }
        }
      }

      const response = await fetch(OPENROUTER_API_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content }],
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        // Refund credit on API error
        await this.creditService.topUp(params.userId, 1, "refund", "AI generation failed")
        throw new Error(`OpenRouter API error ${response.status}: ${errorText}`)
      }

      const data = await response.json()

      // Extract image from response
      const imageData = this.extractImage(data)
      if (!imageData) {
        await this.creditService.topUp(params.userId, 1, "refund", "No image in AI response")
        throw new Error("No image generated in response")
      }

      if (params.save) {
        const fname = params.filename || `generated-${Date.now()}.png`
        const file = await this.fileStorageService.uploadBase64(params.userId, {
          filename: fname,
          mimeType: imageData.mime_type,
          base64Data: imageData.base64_data,
          metadata: params.metadata,
        })

        const url = await this.fileStorageService.getSignedUrl(params.userId, file.id)
        return { saved: true, file_id: file.id, url }
      }

      return { saved: false, base64_data: imageData.base64_data, mime_type: imageData.mime_type }
    } catch (e) {
      // Re-throw — credit already refunded in the specific error paths above
      throw e
    }
  }

  /**
   * Extract base64 image from OpenRouter/Gemini response
   */
  private extractImage(data: any): { base64_data: string; mime_type: string } | null {
    const choices = data.choices || []
    for (const choice of choices) {
      const content = choice.message?.content
      if (!content) continue

      // String response with inline_data (Gemini format)
      if (typeof content === "string") {
        // Check if it's a base64 image directly
        if (content.length > 1000 && !content.includes(" ")) {
          return { base64_data: content, mime_type: "image/png" }
        }
        continue
      }

      // Array of content parts
      if (Array.isArray(content)) {
        for (const part of content) {
          // Gemini inline_data format
          if (part.type === "inline_data" || part.inline_data) {
            const inlineData = part.inline_data || part
            return {
              base64_data: inlineData.data,
              mime_type: inlineData.mime_type || "image/png",
            }
          }
          // Standard image_url format
          if (part.type === "image_url" && part.image_url?.url) {
            const url = part.image_url.url
            if (url.startsWith("data:")) {
              const match = url.match(/^data:([^;]+);base64,(.+)$/)
              if (match) {
                return { base64_data: match[2], mime_type: match[1] }
              }
            }
          }
        }
      }
    }
    return null
  }
}

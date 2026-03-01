import type { MedusaRequest, MedusaResponse } from "@medusajs/framework"
import { NOTE_MODULE } from "../../../modules/note"

export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const service: any = req.scope.resolve(NOTE_MODULE)
  const items = await service.listNotes()
  res.json({ items })
}

export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const { title, content } = req.body as {
    title: string
    content?: string
  }

  if (!title) {
    res.status(400).json({ error: "title is required" })
    return
  }

  const service: any = req.scope.resolve(NOTE_MODULE)
  const item = await service.createNotes({ title, content })
  res.status(201).json({ item })
}

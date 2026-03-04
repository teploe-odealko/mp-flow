import { Entity, PrimaryKey, Property, Index, Enum } from "@mikro-orm/core"
import { v4 } from "uuid"

export interface PhotoFrame {
  index: number
  concept: string
  svg_content?: string
  svg_feedback?: string
  status: "concept" | "svg_draft" | "svg_approved" | "generating" | "generated" | "failed"
  source_images?: string[]
  generated_file_id?: string
  generation_prompt?: string
  generation_feedback?: string
  attempts: number
}

export interface PhotoResearch {
  product_title?: string
  product_description?: string
  ozon_images?: string[]
  ozon_attributes?: Record<string, any>
  ali1688_images?: string[]
  manual_uploads?: string[]
  buyer_pain_points?: string[]
  competitor_insights?: string[]
  key_selling_points?: string[]
}

@Entity({ tableName: "photo_project" })
export class PhotoProject {
  @PrimaryKey({ type: "text" })
  id: string = v4()

  @Property({ type: "text" })
  @Index()
  user_id!: string

  @Property({ type: "text" })
  @Index()
  master_card_id!: string

  @Enum({ items: ["draft", "planned", "svg_review", "generating", "completed"], default: "draft" })
  @Index()
  status: "draft" | "planned" | "svg_review" | "generating" | "completed" = "draft"

  @Property({ type: "json", nullable: true })
  research?: PhotoResearch | null

  @Property({ type: "json", default: "[]" })
  frames: PhotoFrame[] = []

  @Property({ type: "int", default: 0 })
  total_frames: number = 0

  @Property({ type: "int", default: 0 })
  approved_frames: number = 0

  @Property({ type: "int", default: 0 })
  generated_frames: number = 0

  @Property({ type: "text", nullable: true })
  error?: string | null

  @Property({ type: "timestamptz", defaultRaw: "now()" })
  created_at: Date = new Date()

  @Property({ type: "timestamptz", defaultRaw: "now()", onUpdate: () => new Date() })
  updated_at: Date = new Date()
}

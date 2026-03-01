import { MedusaService } from "@medusajs/framework/utils"
import Note from "./models/note"

class NoteModuleService extends MedusaService({
  Note,
}) {
  async getActiveNotes() {
    return this.listNotes({ is_active: true })
  }
}

export default NoteModuleService

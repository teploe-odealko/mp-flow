import { Module } from "@medusajs/utils"
import NoteModuleService from "./service"

export const NOTE_MODULE = "noteModuleService"

export default Module(NOTE_MODULE, {
  service: NoteModuleService,
})

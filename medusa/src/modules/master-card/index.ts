import { Module } from "@medusajs/framework/utils"
import MasterCardModuleService from "./service"

export const MASTER_CARD_MODULE = "masterCardModuleService"

export default Module(MASTER_CARD_MODULE, {
  service: MasterCardModuleService,
})

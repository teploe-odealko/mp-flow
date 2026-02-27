import { ModuleProvider, Modules } from "@medusajs/framework/utils"
import LogtoAuthService from "./service"

export default ModuleProvider(Modules.AUTH, {
  services: [LogtoAuthService],
})

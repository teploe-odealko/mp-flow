import { MedusaService } from "@medusajs/framework/utils"
import MasterCard from "./models/master-card"

class MasterCardModuleService extends MedusaService({
  MasterCard,
}) {}

export default MasterCardModuleService

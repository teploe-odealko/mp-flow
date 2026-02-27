import MasterCardModule from "../modules/master-card"
import OzonIntegrationModule from "../modules/ozon-integration"
import { defineLink } from "@medusajs/framework/utils"

export default defineLink(
  MasterCardModule.linkable.masterCard,
  {
    linkable: OzonIntegrationModule.linkable.ozonProductLink,
    isList: true,
  }
)

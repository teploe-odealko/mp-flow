import OzonIntegrationModule from "../modules/ozon-integration"
import { defineLink } from "@medusajs/framework/utils"

// MasterCard — core module, referenced by string config (no core import)
const masterCardLinkable = {
  serviceName: "masterCardModuleService",
  field: "masterCard",
  linkable: "master_card_id",
  primaryKey: "id",
  entity: "MasterCard",
}

export default defineLink(
  masterCardLinkable,
  {
    linkable: OzonIntegrationModule.linkable.ozonProductLink,
    isList: true,
  }
)

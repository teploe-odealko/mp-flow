import MasterCardModule from "../modules/master-card"
import SaleModule from "../modules/sale"
import { defineLink } from "@medusajs/framework/utils"

export default defineLink(
  MasterCardModule.linkable.masterCard,
  {
    linkable: SaleModule.linkable.saleItem,
    isList: true,
  }
)

import MasterCardModule from "../modules/master-card"
import SupplierOrderModule from "../modules/supplier-order"
import { defineLink } from "@medusajs/framework/utils"

export default defineLink(
  MasterCardModule.linkable.masterCard,
  {
    linkable: SupplierOrderModule.linkable.supplierOrderItem,
    isList: true,
  }
)

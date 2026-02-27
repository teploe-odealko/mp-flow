import SupplierOrderModule from "../modules/supplier-order"
import FinanceModule from "../modules/finance"
import { defineLink } from "@medusajs/framework/utils"

export default defineLink(
  SupplierOrderModule.linkable.supplierOrder,
  {
    linkable: FinanceModule.linkable.financeTransaction,
    isList: true,
  }
)

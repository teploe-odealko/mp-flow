import SaleModule from "../modules/sale"
import FinanceModule from "../modules/finance"
import { defineLink } from "@medusajs/framework/utils"

export default defineLink(
  SaleModule.linkable.sale,
  {
    linkable: FinanceModule.linkable.financeTransaction,
    isList: true,
  }
)

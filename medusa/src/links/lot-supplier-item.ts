import FifoLotModule from "../modules/fifo-lot"
import SupplierOrderModule from "../modules/supplier-order"
import { defineLink } from "@medusajs/framework/utils"

export default defineLink(
  FifoLotModule.linkable.fifoLot,
  SupplierOrderModule.linkable.supplierOrderItem
)

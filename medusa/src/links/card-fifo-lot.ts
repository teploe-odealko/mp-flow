import MasterCardModule from "../modules/master-card"
import FifoLotModule from "../modules/fifo-lot"
import { defineLink } from "@medusajs/framework/utils"

export default defineLink(
  MasterCardModule.linkable.masterCard,
  {
    linkable: FifoLotModule.linkable.fifoLot,
    isList: true,
  }
)

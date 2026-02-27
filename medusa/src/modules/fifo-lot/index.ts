import { Module } from "@medusajs/utils";
import FifoLotModuleService from "./service";

export const FIFO_LOT_MODULE = "fifoLotModuleService";

export default Module(FIFO_LOT_MODULE, {
  service: FifoLotModuleService,
});

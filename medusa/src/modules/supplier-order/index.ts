import { Module } from "@medusajs/utils";
import SupplierOrderModuleService from "./service";

export const SUPPLIER_ORDER_MODULE = "supplierOrderModuleService";

export default Module(SUPPLIER_ORDER_MODULE, {
  service: SupplierOrderModuleService,
});

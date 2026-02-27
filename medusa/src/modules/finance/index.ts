import { Module } from "@medusajs/utils";
import FinanceModuleService from "./service";

export const FINANCE_MODULE = "financeModuleService";

export default Module(FINANCE_MODULE, {
  service: FinanceModuleService,
});

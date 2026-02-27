import { Module } from "@medusajs/utils";
import OzonIntegrationModuleService from "./service";

export const OZON_MODULE = "ozonIntegrationModuleService";

export default Module(OZON_MODULE, {
  service: OzonIntegrationModuleService,
});

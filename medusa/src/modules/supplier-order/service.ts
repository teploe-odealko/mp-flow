import { MedusaService } from "@medusajs/utils";
import SupplierOrder from "./models/supplier-order";
import SupplierOrderItem from "./models/supplier-order-item";

class SupplierOrderModuleService extends MedusaService({
  SupplierOrder,
  SupplierOrderItem,
}) {}

export default SupplierOrderModuleService;

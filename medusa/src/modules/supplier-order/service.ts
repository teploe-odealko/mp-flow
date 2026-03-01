import { MedusaService } from "@medusajs/utils";
import SupplierOrder from "./models/supplier-order";
import SupplierOrderItem from "./models/supplier-order-item";
import Supplier from "./models/supplier";

class SupplierOrderModuleService extends MedusaService({
  SupplierOrder,
  SupplierOrderItem,
  Supplier,
}) {}

export default SupplierOrderModuleService;

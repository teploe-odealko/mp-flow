import type { AwilixContainer } from "awilix"
import { asValue } from "awilix"
import type { MikroORM } from "@mikro-orm/core"
import { MasterCardService } from "../modules/master-card/service.js"
import { SupplierOrderService } from "../modules/supplier-order/service.js"
import { FinanceService } from "../modules/finance/service.js"
import { SaleService } from "../modules/sale/service.js"
import { PluginSettingService } from "../modules/plugin-setting/service.js"

/**
 * Create a request-scoped DI container with a fresh EntityManager fork.
 * Each HTTP request / cron job gets its own EM and service instances.
 */
export function createRequestScope(container: AwilixContainer, orm: MikroORM) {
  const em = orm.em.fork()
  const scope = container.createScope()
  scope.register({
    em: asValue(em),
    masterCardService: asValue(new MasterCardService(em)),
    supplierOrderService: asValue(new SupplierOrderService(em)),
    financeService: asValue(new FinanceService(em)),
    saleService: asValue(new SaleService(em)),
    pluginSettingService: asValue(new PluginSettingService(em)),
  })
  return { scope, em }
}

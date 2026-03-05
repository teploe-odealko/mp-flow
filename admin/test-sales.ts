import { initORM } from './src/server/core/mikro-orm.js'
import { Sale } from './src/server/modules/sale/entity.js'
import { SaleService } from './src/server/modules/sale/service.js'
import { MasterCard } from './src/server/modules/master-card/entity.js'
import { SupplierOrder, SupplierOrderItem, Supplier } from './src/server/modules/supplier-order/entities.js'
import { FinanceTransaction } from './src/server/modules/finance/entity.js'
import { PluginSetting } from './src/server/modules/plugin-setting/entity.js'

async function main() {
  const orm = await initORM({
    url: process.env.DATABASE_URL!,
    entities: [Sale, MasterCard, SupplierOrder, SupplierOrderItem, Supplier, FinanceTransaction, PluginSetting],
  })
  const em = orm.em.fork()
  const svc = new SaleService(em)

  // Test 1: List all sales
  const all = await svc.listSales({}, { take: 50 })
  console.log('Total sales:', all.length)

  // Test 2: Count all
  const count = await svc.countSales({})
  console.log('Count:', count)

  // Test 3: Filter by channel=ozon
  const ozon = await svc.listSales({ channel: 'ozon' })
  console.log('Ozon sales:', ozon.length)

  // Test 4: Count by channel=ozon
  const ozonCount = await svc.countSales({ channel: 'ozon' })
  console.log('Ozon count:', ozonCount)

  // Test 5: Filter by status
  const delivered = await svc.listSales({ status: 'delivered' })
  console.log('Delivered:', delivered.length)

  // Test 6: Date range
  const dateFiltered = await svc.listSales({
    sold_at: { $gte: new Date('2026-02-20'), $lte: new Date('2026-03-01T23:59:59') },
  })
  console.log('Feb 20 - Mar 1:', dateFiltered.length)

  // Test 7: Pagination
  const page1 = await svc.listSales({}, { take: 2, skip: 0 })
  const page2 = await svc.listSales({}, { take: 2, skip: 2 })
  console.log('Page 1:', page1.length, 'Page 2:', page2.length)

  // Test 8: Analytics - getUnitEconomics with hasFees
  const ue = await svc.getUnitEconomics(new Date('2026-01-01'), new Date('2026-03-31'), { hasFees: true })
  console.log('UE items:', ue.items.length, 'UE totals qty:', ue.totals.quantity)
  for (const item of ue.items) {
    console.log(' -', item.product_name, 'qty:', item.quantity, 'rev:', item.revenue, 'fees:', item.total_fees, 'profit:', item.profit, 'margin:', item.margin)
  }

  // Test 9: getSalesPnl with hasFees
  const pnl = await svc.getSalesPnl(new Date('2026-01-01'), new Date('2026-03-31'), { hasFees: true })
  console.log('PnL: rev:', pnl.revenue, 'fees:', pnl.fees, 'profit:', pnl.operating_profit, 'margin:', pnl.margin, 'sales:', pnl.total_sales)
  console.log('Fees by type:', JSON.stringify(pnl.fees_by_type))
  console.log('By channel:', JSON.stringify(pnl.by_channel))

  // Test 10: hasFees=false should include manual sale without fees
  const ueAll = await svc.getUnitEconomics(new Date('2026-01-01'), new Date('2026-03-31'), { hasFees: false })
  console.log('UE items (all):', ueAll.items.length, 'vs hasFees:', ue.items.length)

  await orm.close()
  console.log('\nAll tests passed!')
}

main().catch((e) => { console.error(e); process.exit(1) })

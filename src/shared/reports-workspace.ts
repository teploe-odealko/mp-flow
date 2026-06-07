import {
  channelFinanceSaleAllocations,
  isChannelOperatingTreatment,
  isVariableMarketplaceTreatment
} from "./channel-finance";

type Row = Record<string, any>;

export interface ReportsWorkspaceInput {
  channelFinanceEvents: Row[];
  chartAccounts: Row[];
  documents: Row[];
  journalEntries: Row[];
  journalLines: Row[];
  operatingExpenses: Row[];
  ownerTransactions: Row[];
  products: Row[];
  saleLines: Row[];
  sales: Row[];
  salesChannels: Row[];
}

export interface ReportsWorkspaceOptions {
  dateFrom: string;
  dateTo: string;
  balanceDate: string;
  compareBalanceDate?: string;
  pnlGranularity: "week" | "month";
}

export function buildReportsWorkspacePayload(input: ReportsWorkspaceInput, options: ReportsWorkspaceOptions) {
  const current = buildReportData(input, options.dateFrom, options.dateTo);
  return {
    current,
    balanceCurrent: buildBalanceSnapshot(input, options.balanceDate),
    balanceCompare: options.compareBalanceDate ? buildBalanceSnapshot(input, options.compareBalanceDate) : undefined,
    pnlTree: buildPnlTree(current),
    pnlTrend: buildPnlTrendSeries(input, options.dateFrom, options.dateTo, options.pnlGranularity),
    unitRows: current.unitRows,
    unitFinanceLag: current.financeLag,
    productOptions: input.products.map((product) => ({ id: product.id, sku: product.sku, name: product.name })),
    channelOptions: input.salesChannels.map((channel) => ({ id: channel.id, name: channel.name }))
  };
}

function buildReportData(state: ReportsWorkspaceInput, from: string, to: string) {
  const documents = state.documents.filter((document) => document.accountingDate >= from && document.accountingDate <= to);
  const journalEntries = state.journalEntries.filter((entry) => entry.accountingDate >= from && entry.accountingDate <= to);
  const journalEntryIds = new Set(journalEntries.map((entry) => entry.id));
  const journalLines = state.journalLines.filter((line) => journalEntryIds.has(line.journalEntryId));
  const financeEvents = state.channelFinanceEvents.filter((event) => event.occurredAt >= from && event.occurredAt <= to && event.status === "posted");
  const operatingExpenses = state.operatingExpenses.filter((expense) => expense.expenseDate >= from && expense.expenseDate <= to && expense.paymentStatus !== "draft");
  const sales = state.sales.filter((sale) => sale.saleDate >= from && sale.saleDate <= to && sale.status === "posted");

  const revenue = netCreditJournal(journalLines, "90.01");
  const costOfSales = netDebitJournal(journalLines, "90.02");
  const commissionExpense = sumFinance(financeEvents, (event) => isVariableMarketplaceTreatment(event.treatment) && event.category === "commission");
  const acquiringExpense = sumFinance(financeEvents, (event) => isVariableMarketplaceTreatment(event.treatment) && event.category === "acquiring");
  const lastMileExpense = sumFinance(financeEvents, (event) => isVariableMarketplaceTreatment(event.treatment) && event.category === "last_mile_logistics");
  const returnLogisticsExpense = sumFinance(financeEvents, (event) => isVariableMarketplaceTreatment(event.treatment) && event.category === "return_logistics");
  const otherVariableMarketplaceExpense = sumFinance(
    financeEvents,
    (event) =>
      isVariableMarketplaceTreatment(event.treatment) &&
      !["commission", "acquiring", "last_mile_logistics", "return_logistics"].includes(String(event.category ?? ""))
  );
  const variableMarketplaceExpenses = round2(commissionExpense + acquiringExpense + lastMileExpense + returnLogisticsExpense + otherVariableMarketplaceExpense);
  const adsExpense = sumFinance(financeEvents, (event) => event.category === "ads");
  const storageExpense = sumFinance(financeEvents, (event) => isChannelOperatingTreatment(event.treatment) && event.category === "storage");
  const crossDockingExpense = sumFinance(financeEvents, (event) => isChannelOperatingTreatment(event.treatment) && event.category === "cross_docking");
  const inboundHandlingExpense = sumFinance(financeEvents, (event) => isChannelOperatingTreatment(event.treatment) && event.category === "inbound_handling");
  const subscriptionExpense = sumFinance(financeEvents, (event) => isChannelOperatingTreatment(event.treatment) && event.category === "subscription");
  const storageHandlingExpense = round2(storageExpense + crossDockingExpense + inboundHandlingExpense);
  const otherChannelExpense = sumFinance(
    financeEvents,
    (event) =>
      isChannelOperatingTreatment(event.treatment) &&
      !["ads", "storage", "cross_docking", "inbound_handling", "subscription"].includes(String(event.category ?? ""))
  );
  const channelOperatingExpenses = round2(adsExpense + storageExpense + crossDockingExpense + inboundHandlingExpense + subscriptionExpense + otherChannelExpense);
  const operatingExpenseRub = round2(operatingExpenses.reduce((sum, expense) => sum + Number(expense.amountRub ?? 0), 0));
  const otherIncome = netCreditJournal(journalLines, "91.01");
  const otherExpense = netDebitJournal(journalLines, "91.02");
  const grossProfit = round2(revenue - costOfSales);
  const contributionProfit = round2(grossProfit - variableMarketplaceExpenses);
  const totalExpenses = round2(costOfSales + variableMarketplaceExpenses + channelOperatingExpenses + operatingExpenseRub + otherExpense);
  const netProfit = round2(contributionProfit - channelOperatingExpenses - operatingExpenseRub + otherIncome - otherExpense);
  const netMarginPercent = revenue > 0 ? round2((netProfit / revenue) * 100) : 0;
  const balancesToDate = accumulateBalances(state.journalEntries, state.journalLines, to);
  const ownerContributions = state.ownerTransactions.filter((row) => row.transactionType === "contribution").reduce((sum, row) => sum + Number(row.amountRub ?? 0), 0);
  const ownerWithdrawals = state.ownerTransactions.filter((row) => row.transactionType === "withdrawal").reduce((sum, row) => sum + Number(row.amountRub ?? 0), 0);
  const unitRows = buildUnitRows(state, sales, to);
  const financeLag = buildFinanceLag(state, sales, to);

  return {
    pnl: {
      revenue,
      costOfSales,
      grossProfit,
      afterCostOfSales: grossProfit,
      variableMarketplaceExpenses,
      commissionExpense,
      acquiringExpense,
      lastMileExpense,
      returnLogisticsExpense,
      otherVariableMarketplaceExpense,
      contributionProfit,
      afterMarketplaceExpenses: contributionProfit,
      adsExpense,
      storageExpense,
      crossDockingExpense,
      inboundHandlingExpense,
      subscriptionExpense,
      storageHandlingExpense,
      otherChannelExpense,
      channelOperatingExpenses,
      operatingExpenses: operatingExpenseRub,
      otherIncome,
      otherExpense,
      totalExpenses,
      netProfit,
      netMarginPercent
    },
    documents,
    journalEntries,
    journalLines,
    financeEvents,
    operatingExpenses,
    financeLag,
    balance: {
      cash: debitBalance(balancesToDate["50"]) + debitBalance(balancesToDate["51"]),
      inventory: debitBalance(balancesToDate["41.01"]) + debitBalance(balancesToDate["41.02"]) + debitBalance(balancesToDate["41.03"]),
      marketplaceAwaitingAccrual: debitBalance(balancesToDate["45.03"]),
      supplierAdvances: debitBalance(balancesToDate["60.02"]),
      marketplaceReceivable: debitBalance(balancesToDate["76.ТП"]),
      supplierPayables: creditBalance(balancesToDate["60.01"]),
      unpaidExpenses: state.operatingExpenses.filter((expense) => expense.paymentStatus === "unpaid").reduce((sum, expense) => sum + Number(expense.amountRub ?? 0), 0),
      channelObligations: Math.max(0, creditBalance(balancesToDate["76.ТП"]) - debitBalance(balancesToDate["76.ТП"])),
      ownerContributions,
      ownerWithdrawals,
      retainedEarnings: netProfit,
      assets: debitBalance(balancesToDate["50"]) + debitBalance(balancesToDate["51"]) + debitBalance(balancesToDate["41.01"]) + debitBalance(balancesToDate["41.02"]) + debitBalance(balancesToDate["41.03"]) + debitBalance(balancesToDate["45.03"]) + debitBalance(balancesToDate["60.02"]) + debitBalance(balancesToDate["76.ТП"]),
      liabilities: creditBalance(balancesToDate["60.01"]) + Math.max(0, creditBalance(balancesToDate["76.ТП"]) - debitBalance(balancesToDate["76.ТП"])) + state.operatingExpenses.filter((expense) => expense.paymentStatus === "unpaid").reduce((sum, expense) => sum + Number(expense.amountRub ?? 0), 0),
      equity: ownerContributions - ownerWithdrawals + netProfit
    },
    sales,
    unitRows
  };
}

function buildBalanceSnapshot(state: ReportsWorkspaceInput, asOf: string) {
  const balancesToDate = accumulateBalances(state.journalEntries, state.journalLines, asOf);
  const ownerContributions = creditBalance(balancesToDate["80.01"]);
  const ownerWithdrawals = debitBalance(balancesToDate["80.02"]);
  const retainedEarnings = buildAccumulatedResult(state.chartAccounts, balancesToDate);
  const cash = debitBalance(balancesToDate["50"]) + debitBalance(balancesToDate["51"]);
  const inventory = debitBalance(balancesToDate["41.01"]) + debitBalance(balancesToDate["41.02"]) + debitBalance(balancesToDate["41.03"]);
  const marketplaceAwaitingAccrual = debitBalance(balancesToDate["45.03"]);
  const supplierAdvances = debitBalance(balancesToDate["60.02"]);
  const supplierClaims = debitBalance(balancesToDate["76.02"]);
  const marketplaceReceivable = debitBalance(balancesToDate["76.ТП"]);
  const supplierPayables = creditBalance(balancesToDate["60.01"]);
  const unpaidExpenses = state.operatingExpenses
    .filter((expense) => expense.paymentStatus === "unpaid" && expense.expenseDate <= asOf)
    .reduce((sum, expense) => sum + Number(expense.amountRub ?? 0), 0);
  const channelObligations = creditBalance(balancesToDate["76.ТП"]);
  const assets = round2(cash + inventory + marketplaceAwaitingAccrual + supplierAdvances + supplierClaims + marketplaceReceivable);
  const liabilities = round2(supplierPayables + unpaidExpenses + channelObligations);
  const equity = round2(ownerContributions - ownerWithdrawals + retainedEarnings);
  return {
    asOf,
    cash,
    inventory,
    marketplaceAwaitingAccrual,
    supplierAdvances,
    supplierClaims,
    marketplaceReceivable,
    supplierPayables,
    unpaidExpenses,
    channelObligations,
    ownerContributions,
    ownerWithdrawals,
    retainedEarnings,
    assets,
    liabilities,
    equity,
    difference: round2(assets - liabilities - equity)
  };
}

function buildUnitRows(state: ReportsWorkspaceInput, sales: Row[], to: string) {
  const saleIds = new Set(sales.map((sale) => sale.id));
  const lines = state.saleLines.filter((line) => saleIds.has(line.saleId));
  const financeEvents = state.channelFinanceEvents.filter((event) => event.occurredAt <= to && event.status === "posted");
  const salesById = new Map(sales.map((sale) => [sale.id, sale]));
  const financeBySale = new Map<string, any>();
  const settledThroughByChannel = buildVariableFinanceSettledThrough(financeEvents);

  for (const event of financeEvents) {
    if (!isVariableMarketplaceTreatment(event.treatment)) continue;
    for (const allocation of channelFinanceSaleAllocations(event as any)) {
      const current = financeBySale.get(allocation.saleId) ?? {
        commissionRub: 0,
        acquiringRub: 0,
        lastMileRub: 0,
        returnLogisticsRub: 0,
        otherVariableRub: 0,
        categoryBreakdown: new Map<string, number>()
      };
      if (event.category === "commission") current.commissionRub += allocation.amountRub;
      else if (event.category === "acquiring") current.acquiringRub += allocation.amountRub;
      else if (event.category === "last_mile_logistics") current.lastMileRub += allocation.amountRub;
      else if (event.category === "return_logistics") current.returnLogisticsRub += allocation.amountRub;
      else current.otherVariableRub += allocation.amountRub;
      const category = String(event.category ?? "other");
      current.categoryBreakdown.set(category, round2(Number(current.categoryBreakdown.get(category) ?? 0) + Number(allocation.amountRub ?? 0)));
      financeBySale.set(allocation.saleId, current);
    }
  }

  const grouped = new Map<string, any>();
  for (const line of lines) {
    const sale = salesById.get(line.saleId);
    if (!sale) continue;
    const product = state.products.find((candidate) => candidate.id === line.productId);
    const channel = state.salesChannels.find((candidate) => candidate.id === sale.channelId);
    const saleFees = financeBySale.get(sale.id) ?? {
      commissionRub: 0,
      acquiringRub: 0,
      lastMileRub: 0,
      returnLogisticsRub: 0,
      otherVariableRub: 0,
      categoryBreakdown: new Map<string, number>()
    };
    const saleRevenue = saleRevenueRub(sale);
    const share = saleRevenue > 0 ? Number(line.revenueRub ?? 0) / saleRevenue : 0;
    const settledThrough = settledThroughByChannel.get(sale.channelId);
    const isProvisionalSale = !settledThrough || sale.saleDate > settledThrough;
    const key = `${line.productId}:${sale.channelId}`;
    const current = grouped.get(key) ?? {
      product,
      channel,
      isProvisional: false,
      qtySold: 0,
      unsettledQty: 0,
      revenueRub: 0,
      unsettledRevenueRub: 0,
      costRub: 0,
      commissionRub: 0,
      acquiringRub: 0,
      lastMileRub: 0,
      returnLogisticsRub: 0,
      logisticsRub: 0,
      otherVariableRub: 0,
      otherFeesRub: 0,
      variableFeesRub: 0,
      profitRub: 0,
      marginPercent: 0,
      roiPercent: 0,
      settledThrough,
      categoryBreakdown: [] as Array<{ category: string; amountRub: number }>
    };
    current.isProvisional = current.isProvisional || isProvisionalSale;
    current.qtySold += Number(line.qty ?? 0);
    current.unsettledQty += isProvisionalSale ? Number(line.qty ?? 0) : 0;
    current.revenueRub += Number(line.revenueRub ?? 0);
    current.unsettledRevenueRub += isProvisionalSale ? Number(line.revenueRub ?? 0) : 0;
    current.costRub += Number(line.costRub ?? 0);
    current.commissionRub += round2(saleFees.commissionRub * share);
    current.acquiringRub += round2(saleFees.acquiringRub * share);
    current.lastMileRub += round2(saleFees.lastMileRub * share);
    current.returnLogisticsRub += round2(saleFees.returnLogisticsRub * share);
    current.logisticsRub = round2(current.lastMileRub + current.returnLogisticsRub);
    current.otherVariableRub += round2(saleFees.otherVariableRub * share);
    current.otherFeesRub = round2(current.otherVariableRub);
    for (const [category, amountRub] of saleFees.categoryBreakdown.entries()) {
      const allocatedRub = round2(Number(amountRub ?? 0) * share);
      const currentCategory = current.categoryBreakdown.find((item: any) => item.category === category);
      if (currentCategory) currentCategory.amountRub = round2(currentCategory.amountRub + allocatedRub);
      else current.categoryBreakdown.push({ category, amountRub: allocatedRub });
    }
    current.variableFeesRub = round2(current.commissionRub + current.acquiringRub + current.logisticsRub + current.otherFeesRub);
    current.profitRub = round2(current.revenueRub - current.costRub - current.commissionRub - current.acquiringRub - current.logisticsRub - current.otherFeesRub);
    current.marginPercent = current.revenueRub > 0 ? round2((current.profitRub / current.revenueRub) * 100) : 0;
    current.roiPercent = current.costRub > 0 ? round2((current.profitRub / current.costRub) * 100) : 0;
    grouped.set(key, current);
  }

  return [...grouped.values()].sort((left, right) => right.revenueRub - left.revenueRub);
}

function buildFinanceLag(state: ReportsWorkspaceInput, sales: Row[], to: string) {
  const variableFinanceEvents = state.channelFinanceEvents.filter((event) => event.occurredAt <= to && event.status === "posted" && isVariableMarketplaceTreatment(event.treatment));
  const settledThroughByChannel = buildVariableFinanceSettledThrough(variableFinanceEvents);
  const saleIds = new Set(sales.map((sale) => sale.id));
  const saleLines = state.saleLines.filter((line) => saleIds.has(line.saleId));
  const saleLinesBySale = saleLines.reduce((acc: Map<string, Row[]>, line) => {
    const bucket = acc.get(line.saleId) ?? [];
    bucket.push(line);
    acc.set(line.saleId, bucket);
    return acc;
  }, new Map<string, Row[]>());
  const unsettledSales = sales.filter((sale) => {
    const settledThrough = settledThroughByChannel.get(sale.channelId);
    return !settledThrough || sale.saleDate > settledThrough;
  });
  const unsettledQty = round2(unsettledSales.reduce((sum, sale) => {
    const linesForSale = saleLinesBySale.get(sale.id) ?? [];
    return sum + linesForSale.reduce((lineSum, line) => lineSum + Number(line.qty ?? 0), 0);
  }, 0));
  return {
    unsettledSalesCount: unsettledSales.length,
    unsettledSalesRevenueRub: round2(unsettledSales.reduce((sum, sale) => sum + saleRevenueRub(sale), 0)),
    unsettledQty,
    settledThroughByChannel: Object.fromEntries(settledThroughByChannel.entries())
  };
}

function buildPnlTree(current: ReturnType<typeof buildReportData>) {
  const leaf = (id: string, label: string, amountRub: number, note: string, tone = "neutral") => ({
    id,
    label,
    amountRub: round2(amountRub),
    note,
    documents: [],
    children: [],
    tone
  });
  const branch = (id: string, label: string, amountRub: number, note: string, children: any[], tone = "neutral") => ({
    id,
    label,
    amountRub: round2(amountRub),
    note,
    documents: [],
    children: children.filter((child) => Math.abs(child.amountRub) > 0.0001),
    tone
  });
  const variableMarketplace = branch("marketplace-variable", "Расходы маркетплейса по продажам", current.pnl.variableMarketplaceExpenses, "Расходы маркетплейса, которые относятся прямо к проданным заказам.", [
    leaf("marketplace-commission", "Комиссия маркетплейса", current.pnl.commissionExpense, "Базовая комиссия за продажу товаров на площадке."),
    leaf("marketplace-acquiring", "Эквайринг", current.pnl.acquiringExpense, "Удержания за обработку оплаты покупателя."),
    leaf("marketplace-last-mile", "Доставка до покупателя", current.pnl.lastMileExpense, "Логистика последней мили по фактическим продажам."),
    leaf("marketplace-return-logistics", "Логистика возвратов", current.pnl.returnLogisticsExpense, "Расходы маркетплейса на обратную логистику."),
    leaf("marketplace-other-variable", "Прочие удержания по продажам", current.pnl.otherVariableMarketplaceExpense, "Редкие удержания, которые площадка привязывает к конкретным продажам.")
  ]);
  const channelOperating = branch("channel-operating", "Прочие расходы по маркетплейсу", current.pnl.channelOperatingExpenses, "Расходы канала, которые влияют на прибыль периода, но не относятся к одной продаже.", [
    leaf("channel-ads", "Реклама и продвижение", current.pnl.adsExpense, "Промо, трафареты и другие рекламные списания канала."),
    leaf("channel-storage", "Хранение", current.pnl.storageExpense, "Плата за хранение товаров на складе площадки."),
    leaf("channel-cross-docking", "Кросс-докинг", current.pnl.crossDockingExpense, "Расходы на перегрузку и внутренние перемещения площадки."),
    leaf("channel-inbound", "Приемка и подготовка", current.pnl.inboundHandlingExpense, "Приемка, маркировка и подготовка товара на стороне маркетплейса."),
    leaf("channel-subscription", "Подписки и тарифы", current.pnl.subscriptionExpense, "Регулярные платежи за тарифы и сервисы канала."),
    leaf("channel-other", "Прочие расходы канала", current.pnl.otherChannelExpense, "Операционные списания площадки, которые не относятся к конкретной продаже.")
  ]);
  return [
    branch("income", "Доходы", current.pnl.revenue + current.pnl.otherIncome, "Все доходы периода.", [
      leaf("revenue", "Выручка от продаж", current.pnl.revenue, "Продажи за выбранный период.", "success"),
      leaf("other-income", "Прочие доходы", current.pnl.otherIncome, "Доходы вне обычных продаж.")
    ], "success"),
    branch("expenses", "Расходы", current.pnl.totalExpenses, "Все затраты периода.", [
      leaf("cost-of-sales", "Себестоимость товара", current.pnl.costOfSales, "Списанная себестоимость проданных товаров.", "warning"),
      variableMarketplace,
      channelOperating,
      leaf("operating-expenses", "Операционные расходы бизнеса", current.pnl.operatingExpenses, "Расходы вне маркетплейса."),
      leaf("other-expenses", "Прочие расходы", current.pnl.otherExpense, "Корректировки и разовые списания.")
    ], "warning"),
    leaf("net-profit", "Чистая прибыль", current.pnl.netProfit, "Что осталось после всех расходов периода.", current.pnl.netProfit >= 0 ? "success" : "danger")
  ];
}

function buildPnlTrendSeries(state: ReportsWorkspaceInput, from: string, to: string, granularity: "week" | "month") {
  return buildTrendBuckets(from, to, granularity).map((bucket) => {
    const report = buildReportData(state, bucket.from, bucket.to);
    return {
      label: bucket.label,
      revenue: report.pnl.revenue,
      expenses: report.pnl.totalExpenses,
      netProfit: report.pnl.netProfit
    };
  });
}

function buildTrendBuckets(from: string, to: string, granularity: "week" | "month") {
  if (granularity === "week") {
    const buckets: Array<{ from: string; to: string; label: string }> = [];
    let cursor = from;
    while (cursor <= to) {
      const end = minDate(addDays(cursor, 6), to);
      buckets.push({ from: cursor, to: end, label: `${shortDateLabel(cursor)} - ${shortDateLabel(end)}` });
      cursor = addDays(end, 1);
    }
    return buckets;
  }
  const buckets: Array<{ from: string; to: string; label: string }> = [];
  let cursor = startOfMonth(from);
  const finalMonth = startOfMonth(to);
  while (cursor <= finalMonth) {
    const bucketFrom = cursor < from ? from : cursor;
    const monthEnd = endOfMonth(cursor);
    buckets.push({ from: bucketFrom, to: monthEnd > to ? to : monthEnd, label: monthLabel(bucketFrom) });
    cursor = startOfMonth(addDays(monthEnd, 1));
  }
  return buckets;
}

function sumFinance(events: Row[], predicate: (event: Row) => boolean) {
  return round2(events.filter(predicate).reduce((sum, event) => sum + Number(event.amountRub ?? 0), 0));
}

function accumulateBalances(entries: Row[], lines: Row[], to: string) {
  const entryIds = new Set(entries.filter((entry) => entry.accountingDate <= to).map((entry) => entry.id));
  return lines
    .filter((line) => entryIds.has(line.journalEntryId))
    .reduce<Record<string, { debit: number; credit: number }>>((acc, line) => {
      const current = acc[line.accountCode] ?? { debit: 0, credit: 0 };
      current.debit = round2(current.debit + Number(line.debit ?? 0));
      current.credit = round2(current.credit + Number(line.credit ?? 0));
      acc[line.accountCode] = current;
      return acc;
    }, {});
}

function buildAccumulatedResult(chartAccounts: Row[], balances: Record<string, { debit: number; credit: number }>) {
  return round2(
    chartAccounts.reduce((sum, account) => {
      if (account.kind !== "revenue" && account.kind !== "expense") return sum;
      const balance = balances[account.code] ?? { debit: 0, credit: 0 };
      return sum + Number(balance.credit ?? 0) - Number(balance.debit ?? 0);
    }, 0)
  );
}

function buildVariableFinanceSettledThrough(financeEvents: Row[]) {
  return financeEvents.reduce<Map<string, string>>((acc, event) => {
    if (!isVariableMarketplaceTreatment(event.treatment)) return acc;
    const current = acc.get(event.channelId);
    if (!current || String(event.occurredAt) > current) acc.set(event.channelId, String(event.occurredAt));
    return acc;
  }, new Map());
}

function saleRevenueRub(sale: Row) {
  return Number(sale?.recognizedGrossAmountRub ?? sale?.grossAmountRub ?? 0);
}

function sumJournal(lines: Row[], accountCode: string, side: "debit" | "credit") {
  return round2(lines.filter((line) => line.accountCode === accountCode).reduce((sum, line) => sum + Number(line[side] ?? 0), 0));
}

function netDebitJournal(lines: Row[], accountCode: string) {
  return round2(sumJournal(lines, accountCode, "debit") - sumJournal(lines, accountCode, "credit"));
}

function netCreditJournal(lines: Row[], accountCode: string) {
  return round2(sumJournal(lines, accountCode, "credit") - sumJournal(lines, accountCode, "debit"));
}

function debitBalance(balance?: { debit: number; credit: number }) {
  return Math.max(0, round2((balance?.debit ?? 0) - (balance?.credit ?? 0)));
}

function creditBalance(balance?: { debit: number; credit: number }) {
  return Math.max(0, round2((balance?.credit ?? 0) - (balance?.debit ?? 0)));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function addDays(value: string, days: number) {
  const dateValue = new Date(`${value}T00:00:00`);
  dateValue.setDate(dateValue.getDate() + days);
  return formatLocalDate(dateValue);
}

function minDate(left: string, right: string) {
  return left <= right ? left : right;
}

function startOfMonth(value: string) {
  const dateValue = new Date(`${value}T00:00:00`);
  return formatLocalDate(new Date(dateValue.getFullYear(), dateValue.getMonth(), 1));
}

function endOfMonth(value: string) {
  const dateValue = new Date(`${value}T00:00:00`);
  return formatLocalDate(new Date(dateValue.getFullYear(), dateValue.getMonth() + 1, 0));
}

function shortDateLabel(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short" }).format(new Date(`${value}T00:00:00`));
}

function monthLabel(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { month: "short" }).format(new Date(`${value}T00:00:00`));
}

function formatLocalDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

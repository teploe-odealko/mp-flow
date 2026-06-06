import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Banknote,
  BarChart3,
  ChevronDown,
  ChevronRight,
  ListTree,
  PieChart,
  RefreshCw,
  ScrollText
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Kpi } from "@/components/ui/kpi";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { CheckLabel } from "@/components/ui/checkbox";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pagination } from "@/components/ui/pagination";
import { useCollection } from "@/lib/use-collection";
import { apiPost } from "@/api";
import { rub, date } from "@/lib/format";
import { cn } from "@/lib/cn";
import { paginateRows } from "@/lib/pagination";
import { ProductCell } from "@/components/product-thumb";
import {
  channelFinanceCategoryLabel,
  channelFinanceSaleAllocations,
  linkedExpenseSaleIds,
  isChannelOperatingTreatment,
  isVariableMarketplaceTreatment
} from "../../../shared/channel-finance";

export function ReportsWorkspace() {
  const { pathname } = useLocation();
  const state = { channelFinanceEvents: useCollection<any[]>("channelFinanceEvents") ?? [], chartAccounts: useCollection<any[]>("chartAccounts") ?? [], documents: useCollection<any[]>("documents") ?? [], journalEntries: useCollection<any[]>("journalEntries") ?? [], journalLines: useCollection<any[]>("journalLines") ?? [], operatingExpenses: useCollection<any[]>("operatingExpenses") ?? [], ownerTransactions: useCollection<any[]>("ownerTransactions") ?? [], products: useCollection<any[]>("products") ?? [], saleLines: useCollection<any[]>("saleLines") ?? [], sales: useCollection<any[]>("sales") ?? [], salesChannels: useCollection<any[]>("salesChannels") ?? [] };
  const [dateFrom, setDateFrom] = useState(firstDayOfMonth(new Date()));
  const [dateTo, setDateTo] = useState(lastDayOfMonth(new Date()));
  const [balanceDate, setBalanceDate] = useState(lastDayOfMonth(new Date()));
  const [compareBalance, setCompareBalance] = useState(false);
  const [compareBalanceDate, setCompareBalanceDate] = useState(endOfPreviousMonth(new Date()));
  const [selectedBalanceMetric, setSelectedBalanceMetric] = useState<BalanceMetricKey | null>(null);
  const [selectedUnitKey, setSelectedUnitKey] = useState("");
  const [selectedPnlNodeId, setSelectedPnlNodeId] = useState("net-profit");
  const [pnlDetailOpen, setPnlDetailOpen] = useState(false);
  const [pnlGranularity, setPnlGranularity] = useState<"week" | "month">("week");
  const [expandedPnlNodeIds, setExpandedPnlNodeIds] = useState<string[]>(["income", "expenses"]);
  const [productId, setProductId] = useState("");
  const [channelId, setChannelId] = useState("");
  const [profitability, setProfitability] = useState("");
  const [linkedExpenseStatus, setLinkedExpenseStatus] = useState("");
  const recalc = useMutation({ mutationFn: () => apiPost("/api/reports/recalculate") });

  const routeTab = pathname.includes("profit-and-loss")
    ? "pnl"
    : pathname.includes("balance-sheet")
      ? "balance"
      : pathname.includes("unit-economics")
        ? "unit"
        : "overview";
  const [activeTab, setActiveTab] = useState(routeTab);
  useEffect(() => {
    setActiveTab(routeTab);
  }, [routeTab]);
  const title = activeTab === "pnl"
    ? "Прибыль и убытки"
    : activeTab === "balance"
      ? "Баланс"
      : activeTab === "unit"
        ? "Юнит-экономика"
        : "Отчеты";
  const subtitle = activeTab === "balance"
    ? "Баланс показывает накопленные остатки и капитал на выбранную дату."
    : activeTab === "pnl"
      ? "Отчет показывает результат за выбранный промежуток: сколько выручили, где сели расходы и что осталось в чистой прибыли."
      : "Отчет считается по продажам и начислениям канала. Для последних продаж часть расходов маркетплейса может быть предварительной.";

  const current = useMemo(() => buildReportData(state, dateFrom, dateTo), [dateFrom, dateTo, state]);
  const balanceCurrent = useMemo(() => buildBalanceSnapshot(state, balanceDate), [balanceDate, state]);
  const balanceCompare = useMemo(() => (compareBalance ? buildBalanceSnapshot(state, compareBalanceDate) : undefined), [compareBalance, compareBalanceDate, state]);
  const selectedBalanceDrilldown = useMemo(
    () =>
      selectedBalanceMetric
        ? buildBalanceDrilldown(state, selectedBalanceMetric, balanceDate, compareBalance ? compareBalanceDate : undefined)
        : null,
    [balanceDate, compareBalance, compareBalanceDate, selectedBalanceMetric, state]
  );
  const pnlTree = useMemo(() => buildPnlTree(state, current), [current, state]);
  const selectedPnlNode = useMemo(
    () => findPnlNode(pnlTree, selectedPnlNodeId) ?? pnlTree.find((node) => node.id === "net-profit") ?? pnlTree[0] ?? null,
    [pnlTree, selectedPnlNodeId]
  );
  const pnlTrend = useMemo(() => buildPnlTrendSeries(state, dateFrom, dateTo, pnlGranularity), [dateFrom, dateTo, pnlGranularity, state]);
  const togglePnlNode = (nodeId: string) => {
    setExpandedPnlNodeIds((currentExpanded) =>
      currentExpanded.includes(nodeId)
        ? currentExpanded.filter((id) => id !== nodeId)
        : [...currentExpanded, nodeId]
    );
  };
  const selectPnlNode = (nodeId: string) => {
    setSelectedPnlNodeId(nodeId);
    setPnlDetailOpen(true);
  };
  useEffect(() => {
    if (!selectedPnlNode) {
      setSelectedPnlNodeId(pnlTree.find((node) => node.id === "net-profit")?.id ?? pnlTree[0]?.id ?? "net-profit");
    }
  }, [pnlTree, selectedPnlNode]);
  const pnlMonthFrom = toMonthInputValue(dateFrom);
  const pnlMonthTo = toMonthInputValue(dateTo);
  const setPnlMonthFrom = (monthValue: string) => {
    if (!monthValue) return;
    const nextFrom = startOfMonthValue(monthValue);
    const nextTo = pnlMonthTo < monthValue ? endOfMonthValue(monthValue) : dateTo;
    setDateFrom(nextFrom);
    setDateTo(nextTo);
  };
  const setPnlMonthTo = (monthValue: string) => {
    if (!monthValue) return;
    const nextTo = endOfMonthValue(monthValue);
    const nextFrom = pnlMonthFrom > monthValue ? startOfMonthValue(monthValue) : dateFrom;
    setDateFrom(nextFrom);
    setDateTo(nextTo);
  };
  const salesWithLinkedExpenses = useMemo(
    () => linkedExpenseSaleIds((state.channelFinanceEvents ?? []).filter((event: any) => event.occurredAt <= dateTo)),
    [dateTo, state.channelFinanceEvents]
  );
  const unitSales = useMemo(() => {
    return current.sales.filter((sale: any) => {
      if (linkedExpenseStatus === "with_expenses" && !salesWithLinkedExpenses.has(sale.id)) return false;
      if (linkedExpenseStatus === "without_expenses" && salesWithLinkedExpenses.has(sale.id)) return false;
      return true;
    });
  }, [current.sales, linkedExpenseStatus, salesWithLinkedExpenses]);
  const unitBaseRows = useMemo(() => buildUnitRows(state, unitSales, dateTo), [dateTo, state, unitSales]);
  const unitRows = useMemo(() => {
    return unitBaseRows.filter((row) => {
      if (productId && row.product?.id !== productId) return false;
      if (channelId && row.channel?.id !== channelId) return false;
      if (profitability === "profit" && row.profitRub <= 0) return false;
      if (profitability === "loss" && row.profitRub >= 0) return false;
      return true;
    });
  }, [channelId, unitBaseRows, productId, profitability]);
  const unitFinanceLag = useMemo(() => buildFinanceLag(state, unitSales, dateTo), [dateTo, state, unitSales]);
  const selectedUnitRow = useMemo(
    () => unitRows.find((row) => unitRowKey(row) === selectedUnitKey) ?? unitRows[0],
    [selectedUnitKey, unitRows]
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => recalc.mutate()} disabled={recalc.isPending}><RefreshCw size={14} /> Пересчитать отчет</Button>
            <Button variant="secondary">Экспорт</Button>
          </div>
        }
      />

      <Card>
        <CardContent className="flex flex-wrap gap-2 py-4">
          {activeTab === "balance" ? (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-[var(--color-muted-foreground)]">На дату</span>
                <Input type="date" value={balanceDate} onChange={(event) => setBalanceDate(event.target.value)} className="w-44" />
              </div>
              <div className="flex items-end pb-1">
                <CheckLabel label="Сравнить с другой датой" checked={compareBalance} onCheckedChange={setCompareBalance} />
              </div>
              {compareBalance && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-[var(--color-muted-foreground)]">Дата сравнения</span>
                  <Input type="date" value={compareBalanceDate} onChange={(event) => setCompareBalanceDate(event.target.value)} className="w-44" />
                </div>
              )}
            </>
          ) : (
            <>
              {activeTab === "pnl" ? (
                <>
                  <Input type="month" value={pnlMonthFrom} onChange={(event) => setPnlMonthFrom(event.target.value)} className="w-44" />
                  <Input type="month" value={pnlMonthTo} onChange={(event) => setPnlMonthTo(event.target.value)} className="w-44" />
                </>
              ) : (
                <>
                  <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="w-44" />
                  <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="w-44" />
                </>
              )}
            </>
          )}
          {activeTab === "unit" && (
            <>
              <Select value={channelId} onChange={(event) => setChannelId(event.target.value)} className="w-44">
                <option value="">Все каналы</option>
                {(state.salesChannels ?? []).map((channel: any) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
              </Select>
              <Select value={productId} onChange={(event) => setProductId(event.target.value)} className="w-44">
                <option value="">Все товары</option>
                {(state.products ?? []).map((product: any) => <option key={product.id} value={product.id}>{product.sku}</option>)}
              </Select>
              <Select value={profitability} onChange={(event) => setProfitability(event.target.value)} className="w-44">
                <option value="">Все состояния</option>
                <option value="profit">Прибыльные</option>
                <option value="loss">Убыточные</option>
              </Select>
              <Select value={linkedExpenseStatus} onChange={(event) => setLinkedExpenseStatus(event.target.value)} className="w-56">
                <option value="">Любые расходы</option>
                <option value="with_expenses">Только с привязанными расходами</option>
                <option value="without_expenses">Только без привязанных расходов</option>
              </Select>
            </>
          )}
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="overview"><BarChart3 size={13} /> Обзор</TabsTrigger>
          <TabsTrigger value="pnl"><ScrollText size={13} /> Прибыль и убытки</TabsTrigger>
          <TabsTrigger value="balance"><PieChart size={13} /> Баланс</TabsTrigger>
          <TabsTrigger value="unit"><ListTree size={13} /> Юнит-экономика</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-6">
            <Kpi tone="success" icon={<ArrowUp size={18} />} label="Выручка" value={rub(current.pnl.revenue)} hint={`${current.sales.length} продаж`} />
            <Kpi tone="warning" icon={<ArrowDown size={18} />} label="Себестоимость товара" value={rub(current.pnl.costOfSales)} hint={shareHint(current.pnl.costOfSales, current.pnl.revenue)} />
            <Kpi tone="primary" label="После себестоимости товара" value={rub(current.pnl.afterCostOfSales)} hint={shareHint(current.pnl.afterCostOfSales, current.pnl.revenue)} />
            <Kpi tone="info" icon={<Banknote size={18} />} label="Расходы маркетплейса по продажам" value={rub(current.pnl.variableMarketplaceExpenses)} hint={shareHint(current.pnl.variableMarketplaceExpenses, current.pnl.revenue)} />
            <Kpi tone="primary" label="После расходов маркетплейса" value={rub(current.pnl.afterMarketplaceExpenses)} hint={shareHint(current.pnl.afterMarketplaceExpenses, current.pnl.revenue)} />
            <Kpi tone={current.pnl.netProfit >= 0 ? "success" : "danger"} label="Чистая прибыль" value={rub(current.pnl.netProfit)} hint={shareHint(current.pnl.netProfit, current.pnl.revenue)} />
          </div>
          {current.financeLag.unsettledSalesCount > 0 && (
            <Card className="mt-4">
              <CardContent className="py-4 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">Часть расходов маркетплейса ещё не доехала</div>
                  <div className="text-sm text-[var(--color-muted-foreground)]">
                    До {date(dateTo)} по {current.financeLag.unsettledSalesCount} продажам ещё не пришли все начисления канала. Это влияет только на показатели после расходов маркетплейса и чистую прибыль.
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge tone="neutral">Выручка ждёт начислений {rub(current.financeLag.unsettledSalesRevenueRub)}</Badge>
                  <Badge tone="neutral">Штук {current.financeLag.unsettledQty}</Badge>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="pnl">
          <div className="flex flex-col gap-5">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Итог за период</CardTitle>
                  <CardDescription>
                    С {date(dateFrom)} по {date(dateTo)}. Сначала видно только главное, а детали раскрываются ниже по категориям.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <SummaryMetricTile
                    tone="success"
                    label="Выручка"
                    value={rub(current.pnl.revenue)}
                    hint={`${current.sales.length} продаж`}
                  />
                  <SummaryMetricTile
                    tone="warning"
                    label="Все расходы"
                    value={rub(current.pnl.totalExpenses)}
                    hint={shareHint(current.pnl.totalExpenses, current.pnl.revenue)}
                  />
                  <SummaryMetricTile
                    tone={current.pnl.netProfit >= 0 ? "success" : "danger"}
                    label="Чистая прибыль"
                    value={rub(current.pnl.netProfit)}
                    hint={shareHint(current.pnl.netProfit, current.pnl.revenue)}
                  />
                </div>
                <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
                  <StagePill
                    label="После себестоимости товара"
                    value={rub(current.pnl.afterCostOfSales)}
                    note="Выручка минус себестоимость"
                  />
                  <StagePill
                    label="После расходов маркетплейса"
                    value={rub(current.pnl.afterMarketplaceExpenses)}
                    note="Минус комиссия, эквайринг и логистика"
                  />
                  <StagePill
                    label="Маржинальность"
                    value={plainPercent(current.pnl.netMarginPercent)}
                    note="Чистая прибыль от выручки"
                  />
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-5">
              <Card className="min-w-0">
                <CardHeader>
                  <div className="flex w-full flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle>Динамика внутри периода</CardTitle>
                      <CardDescription>Показываем только выбранный диапазон. Шаг графика можно переключать явно, без скрытой эвристики.</CardDescription>
                    </div>
                    <Select value={pnlGranularity} onChange={(event) => setPnlGranularity(event.target.value as "week" | "month")} className="w-40">
                      <option value="week">По неделям</option>
                      <option value="month">По месяцам</option>
                    </Select>
                  </div>
                </CardHeader>
                <CardContent className="min-w-0">
                  <div className="h-[300px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={pnlTrend} margin={{ top: 12, right: 12, left: -12, bottom: 0 }}>
                        <defs>
                          <linearGradient id="pnl-revenue-fill" x1="0" x2="0" y1="0" y2="1">
                            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.28} />
                            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0.02} />
                          </linearGradient>
                          <linearGradient id="pnl-expenses-fill" x1="0" x2="0" y1="0" y2="1">
                            <stop offset="0%" stopColor="var(--color-warning)" stopOpacity={0.22} />
                            <stop offset="100%" stopColor="var(--color-warning)" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} stroke="rgba(148, 163, 184, 0.18)" />
                        <XAxis dataKey="label" tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }} axisLine={false} tickLine={false} />
                        <YAxis
                          tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }}
                          tickFormatter={formatCompactRub}
                          axisLine={false}
                          tickLine={false}
                          width={68}
                        />
                        <Tooltip content={<PnlTrendTooltip />} />
                        <Area type="monotone" dataKey="revenue" name="Выручка" stroke="var(--color-primary)" fill="url(#pnl-revenue-fill)" strokeWidth={2.2} />
                        <Area type="monotone" dataKey="expenses" name="Расходы" stroke="var(--color-warning)" fill="url(#pnl-expenses-fill)" strokeWidth={2} />
                        <Line type="monotone" dataKey="netProfit" name="Чистая прибыль" stroke="var(--color-success)" strokeWidth={2.2} dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </div>

            {current.financeLag.unsettledSalesCount > 0 && (
              <Card>
                <CardContent className="py-4 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold">Часть чистой прибыли пока предварительная</div>
                    <div className="text-sm text-[var(--color-muted-foreground)]">
                      По {current.financeLag.unsettledSalesCount} продажам ещё не пришли все начисления канала. Поэтому расходы маркетплейса и чистая прибыль могут немного измениться после следующего синка.
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone="neutral">Выручка ждёт начислений {rub(current.financeLag.unsettledSalesRevenueRub)}</Badge>
                    <Badge tone="neutral">Штук {current.financeLag.unsettledQty}</Badge>
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="min-w-0">
              <CardHeader>
                <div>
                  <CardTitle>Структура доходов и расходов</CardTitle>
                  <CardDescription>Раскрывай категории по уровням. Если нужна расшифровка статьи и документы, нажми на строку.</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-[var(--color-border)]">
                  {pnlTree.map((node) => (
                    <PnlTreeRow
                      key={node.id}
                      node={node}
                      depth={0}
                      revenue={current.pnl.revenue}
                      selectedNodeId={selectedPnlNode?.id ?? ""}
                      expandedNodeIds={expandedPnlNodeIds}
                      onToggle={togglePnlNode}
                      onSelect={selectPnlNode}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>

            <PnlDetailDialog
              open={pnlDetailOpen}
              onOpenChange={setPnlDetailOpen}
              node={selectedPnlNode}
              revenue={current.pnl.revenue}
            />
          </div>
        </TabsContent>

        <TabsContent value="balance">
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <Kpi tone="primary" label="Активы" value={rub(balanceCurrent.assets)} />
              <Kpi tone="warning" label="Обязательства" value={rub(balanceCurrent.liabilities)} />
              <Kpi tone="success" label="Капитал" value={rub(balanceCurrent.equity)} />
              <Kpi tone={Math.abs(balanceCurrent.difference) < 0.01 ? "success" : "danger"} label="Разница" value={rub(balanceCurrent.difference, { precise: true })} />
            </div>

            <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_320px]">
              <Card className="min-w-0">
                <CardHeader>
                  <div>
                    <CardTitle>Активы на {date(balanceDate)}</CardTitle>
                    <CardDescription>Накопленные остатки по активным статьям на выбранную дату.</CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <BalanceTable
                    currentDate={balanceDate}
                    compareDate={compareBalance ? compareBalanceDate : undefined}
                    onSelect={setSelectedBalanceMetric}
                    rows={[
                      { key: "cash", label: "Денежные средства", current: balanceCurrent.cash, compare: balanceCompare?.cash, emphasis: true },
                      { key: "inventory", label: "Товары в наличии", current: balanceCurrent.inventory, compare: balanceCompare?.inventory },
                      { key: "marketplaceAwaitingAccrual", label: "Продажи ждут начисления", current: balanceCurrent.marketplaceAwaitingAccrual, compare: balanceCompare?.marketplaceAwaitingAccrual },
                      { key: "supplierAdvances", label: "Авансы поставщикам", current: balanceCurrent.supplierAdvances, compare: balanceCompare?.supplierAdvances },
                      { key: "supplierClaims", label: "Претензии поставщикам", current: balanceCurrent.supplierClaims, compare: balanceCompare?.supplierClaims },
                      { key: "marketplaceReceivable", label: "Дебиторка маркетплейсов", current: balanceCurrent.marketplaceReceivable, compare: balanceCompare?.marketplaceReceivable },
                      { key: "assets", label: "Активы", current: balanceCurrent.assets, compare: balanceCompare?.assets, emphasis: true }
                    ]}
                  />
                </CardContent>
              </Card>

              <Card className="min-w-0">
                <CardHeader>
                  <div>
                    <CardTitle>Источники финансирования</CardTitle>
                    <CardDescription>Обязательства и капитал на ту же дату.</CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <BalanceTable
                    currentDate={balanceDate}
                    compareDate={compareBalance ? compareBalanceDate : undefined}
                    onSelect={setSelectedBalanceMetric}
                    rows={[
                      { key: "supplierPayables", label: "Кредиторка поставщикам", current: balanceCurrent.supplierPayables, compare: balanceCompare?.supplierPayables },
                      { key: "unpaidExpenses", label: "Неоплаченные расходы", current: balanceCurrent.unpaidExpenses, compare: balanceCompare?.unpaidExpenses },
                      { key: "channelObligations", label: "Обязательства по каналам", current: balanceCurrent.channelObligations, compare: balanceCompare?.channelObligations },
                      { key: "liabilities", label: "Обязательства", current: balanceCurrent.liabilities, compare: balanceCompare?.liabilities, emphasis: true },
                      { key: "ownerContributions", label: "Вложения владельца", current: balanceCurrent.ownerContributions, compare: balanceCompare?.ownerContributions },
                      { key: "ownerWithdrawals", label: "Изъятия владельца", current: balanceCurrent.ownerWithdrawals, compare: balanceCompare?.ownerWithdrawals },
                      { key: "retainedEarnings", label: "Накопленный результат", current: balanceCurrent.retainedEarnings, compare: balanceCompare?.retainedEarnings },
                      { key: "equity", label: "Капитал", current: balanceCurrent.equity, compare: balanceCompare?.equity, emphasis: true }
                    ]}
                  />
                </CardContent>
              </Card>

              <Card className="h-fit min-w-0 overflow-hidden">
                <CardHeader className="min-w-0">
                  <div className="min-w-0">
                    <CardTitle>Проверка баланса</CardTitle>
                    <CardDescription>Активы должны быть равны обязательствам и капиталу.</CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="min-w-0 flex flex-col gap-3">
                  <Info label="Активы" value={rub(balanceCurrent.assets)} />
                  <Info label="Обязательства + капитал" value={rub(balanceCurrent.liabilities + balanceCurrent.equity)} />
                  <Info label="Разница" value={rub(balanceCurrent.difference, { precise: true })} />
                  {compareBalance && balanceCompare && (
                    <Info label={`Разница на ${date(compareBalanceDate)}`} value={rub(balanceCompare.difference, { precise: true })} />
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="unit">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-6 mb-5">
            <Kpi tone="success" label="Выручка" value={rub(sum(unitRows, "revenueRub"))} />
            <Kpi tone="warning" label="Себестоимость" value={rub(sum(unitRows, "costRub"))} />
            <Kpi tone="info" label="Перем. расходы МП" value={rub(sum(unitRows, "variableFeesRub"))} />
            <Kpi tone="primary" label="Contribution" value={rub(sum(unitRows, "profitRub"))} />
            <Kpi tone="neutral" label="Средняя маржа" value={formatPercent(average(unitRows.map((row) => row.marginPercent)))} />
            <Kpi tone="neutral" label="Ждёт начислений" value={rub(sum(unitRows, "unsettledRevenueRub"))} />
          </div>
          {unitFinanceLag.unsettledSalesCount > 0 && (
            <Card className="mb-5">
              <CardContent className="py-4 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">Юнит-экономика по части продаж пока предварительная</div>
                  <div className="text-sm text-[var(--color-muted-foreground)]">
                    Для строк со статусом «Предварительно» система уже знает выручку и FIFO-себестоимость, но часть комиссий и логистики ещё не пришла в начислениях канала.
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge tone="neutral">Продаж ждут начислений {unitFinanceLag.unsettledSalesCount}</Badge>
                  <Badge tone="neutral">Выручка {rub(unitFinanceLag.unsettledSalesRevenueRub)}</Badge>
                </div>
              </CardContent>
            </Card>
          )}
          <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]">
            <Card className="min-w-0">
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle>По товарам</CardTitle>
                    <CardDescription>Продажи, FIFO-себестоимость и уже доехавшие sale-linked расходы канала в разрезе товара и канала.</CardDescription>
                  </div>
                  <Button variant="secondary">Показать продажи</Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <THead><TR><TH>Товар</TH><TH>Канал</TH><TH>Статус</TH><TH numeric>Кол-во</TH><TH numeric>Выручка</TH><TH numeric>Себестоимость</TH><TH numeric>Комиссия+эквайринг</TH><TH numeric>Логистика</TH><TH numeric>Прочие fees</TH><TH numeric>Contribution</TH><TH numeric>Маржа</TH><TH numeric>ROI</TH></TR></THead>
                  <TBody>
                    {unitRows.length === 0 ? (
                      <TR><TD colSpan={12} className="text-center py-10 text-[var(--color-muted-foreground)]">Продаж по фильтрам нет</TD></TR>
                    ) : (
                      unitRows.map((row) => (
                        <TR key={unitRowKey(row)} interactive selected={selectedUnitRow ? unitRowKey(row) === unitRowKey(selectedUnitRow) : false} onClick={() => setSelectedUnitKey(unitRowKey(row))}>
                          <TD><ProductCell product={row.product} /></TD>
                          <TD>{row.channel?.name ?? "—"}</TD>
                          <TD><Badge tone={row.isProvisional ? "warning" : "success"}>{row.isProvisional ? "Предварительно" : "Закрыто"}</Badge></TD>
                          <TD numeric>{row.qtySold}</TD>
                          <TD numeric>{rub(row.revenueRub)}</TD>
                          <TD numeric>{rub(row.costRub)}</TD>
                          <TD numeric>{rub(row.commissionRub + row.acquiringRub)}</TD>
                          <TD numeric>{rub(row.logisticsRub)}</TD>
                          <TD numeric>{rub(row.otherFeesRub)}</TD>
                          <TD numeric className={row.profitRub >= 0 ? "text-[var(--color-success)] font-semibold" : "text-[var(--color-danger)] font-semibold"}>{rub(row.profitRub)}</TD>
                          <TD numeric>{formatPercent(row.marginPercent)}</TD>
                          <TD numeric>{formatPercent(row.roiPercent)}</TD>
                        </TR>
                      ))
                    )}
                  </TBody>
                </Table>
              </CardContent>
            </Card>

            <Card className="h-fit min-w-0 overflow-hidden">
              <CardHeader className="min-w-0">
                <div className="min-w-0">
                  <CardTitle>Детализация юнитки</CardTitle>
                  <CardDescription>Разложение прибыли по FIFO-себестоимости и расходам канала для выбранной строки.</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="min-w-0 flex flex-col gap-4">
                {selectedUnitRow ? (
                  <>
                    <Info label="Товар" value={`${selectedUnitRow.product?.name ?? "—"} · ${selectedUnitRow.channel?.name ?? "—"}`} />
                    <Info label="Статус" value={selectedUnitRow.isProvisional ? `Предварительно (${selectedUnitRow.settledThrough ? `начисления есть по ${date(selectedUnitRow.settledThrough)}` : "начисления ещё не пришли"})` : "Начисления канала пришли"} />
                    <Info label="Продано" value={`${selectedUnitRow.qtySold} шт · выручка ${rub(selectedUnitRow.revenueRub)}`} />
                    <Info label="Contribution" value={`${rub(selectedUnitRow.profitRub)} · маржа ${formatPercent(selectedUnitRow.marginPercent)}`} />
                    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)] mb-2">Что вошло в unit economics</div>
                      <div className="space-y-2 text-sm">
                        <BreakdownRow label="FIFO-себестоимость" value={rub(selectedUnitRow.costRub)} />
                        <BreakdownRow label="Комиссия маркетплейса" value={rub(selectedUnitRow.commissionRub)} />
                        <BreakdownRow label="Эквайринг" value={rub(selectedUnitRow.acquiringRub)} />
                        <BreakdownRow label="Логистика до покупателя" value={rub(selectedUnitRow.lastMileRub)} />
                        <BreakdownRow label="Логистика возвратов" value={rub(selectedUnitRow.returnLogisticsRub)} />
                        <BreakdownRow label="Прочие удержания по продаже" value={rub(selectedUnitRow.otherVariableRub)} />
                        <BreakdownRow label="Итого переменные расходы МП" value={rub(selectedUnitRow.variableFeesRub)} />
                      </div>
                    </div>
                    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)] mb-2">Категории канала</div>
                      <div className="space-y-2">
                        {selectedUnitRow.categoryBreakdown.length === 0 ? (
                          <div className="text-sm text-[var(--color-muted-foreground)]">По выбранной строке ещё нет доехавших sale-linked удержаний канала.</div>
                        ) : (
                          selectedUnitRow.categoryBreakdown.map((item: any) => (
                            <BreakdownRow key={item.category} label={channelFinanceCategoryLabel(item.category)} value={rub(item.amountRub)} />
                          ))
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-[var(--color-muted-foreground)]">Выбери строку в таблице, чтобы посмотреть расшифровку.</div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <BalanceDrilldownDialog
        open={Boolean(selectedBalanceDrilldown)}
        onOpenChange={(open) => !open && setSelectedBalanceMetric(null)}
        drilldown={selectedBalanceDrilldown}
      />
    </div>
  );
}

function buildReportData(state: any, from: string, to: string) {
  const documents = (state.documents ?? []).filter((document: any) => document.accountingDate >= from && document.accountingDate <= to);
  const journalEntries = (state.journalEntries ?? []).filter((entry: any) => entry.accountingDate >= from && entry.accountingDate <= to);
  const journalEntryIds = new Set(journalEntries.map((entry: any) => entry.id));
  const journalLines = (state.journalLines ?? []).filter((line: any) => journalEntryIds.has(line.journalEntryId));
  const financeEvents = (state.channelFinanceEvents ?? []).filter((event: any) => event.occurredAt >= from && event.occurredAt <= to && event.status === "posted");
  const operatingExpenses = (state.operatingExpenses ?? []).filter((expense: any) => expense.expenseDate >= from && expense.expenseDate <= to && expense.paymentStatus !== "draft");
  const sales = (state.sales ?? []).filter((sale: any) => sale.saleDate >= from && sale.saleDate <= to && sale.status === "posted");

  const revenue = netCreditJournal(journalLines, "90.01");
  const costOfSales = netDebitJournal(journalLines, "90.02");
  const commissionExpense = financeEvents
    .filter((event: any) => isVariableMarketplaceTreatment(event.treatment) && event.category === "commission")
    .reduce((sum: number, event: any) => sum + event.amountRub, 0);
  const acquiringExpense = financeEvents
    .filter((event: any) => isVariableMarketplaceTreatment(event.treatment) && event.category === "acquiring")
    .reduce((sum: number, event: any) => sum + event.amountRub, 0);
  const lastMileExpense = financeEvents
    .filter((event: any) => isVariableMarketplaceTreatment(event.treatment) && event.category === "last_mile_logistics")
    .reduce((sum: number, event: any) => sum + event.amountRub, 0);
  const returnLogisticsExpense = financeEvents
    .filter((event: any) => isVariableMarketplaceTreatment(event.treatment) && event.category === "return_logistics")
    .reduce((sum: number, event: any) => sum + event.amountRub, 0);
  const otherVariableMarketplaceExpense = financeEvents
    .filter(
      (event: any) =>
        isVariableMarketplaceTreatment(event.treatment) &&
        !["commission", "acquiring", "last_mile_logistics", "return_logistics"].includes(String(event.category ?? ""))
    )
    .reduce((sum: number, event: any) => sum + event.amountRub, 0);
  const variableMarketplaceExpenses = round2(
    commissionExpense + acquiringExpense + lastMileExpense + returnLogisticsExpense + otherVariableMarketplaceExpense
  );
  const adsExpense = financeEvents.filter((event: any) => event.category === "ads").reduce((sum: number, event: any) => sum + event.amountRub, 0);
  const storageExpense = financeEvents
    .filter((event: any) => isChannelOperatingTreatment(event.treatment) && event.category === "storage")
    .reduce((sum: number, event: any) => sum + event.amountRub, 0);
  const crossDockingExpense = financeEvents
    .filter((event: any) => isChannelOperatingTreatment(event.treatment) && event.category === "cross_docking")
    .reduce((sum: number, event: any) => sum + event.amountRub, 0);
  const inboundHandlingExpense = financeEvents
    .filter((event: any) => isChannelOperatingTreatment(event.treatment) && event.category === "inbound_handling")
    .reduce((sum: number, event: any) => sum + event.amountRub, 0);
  const subscriptionExpense = financeEvents
    .filter((event: any) => isChannelOperatingTreatment(event.treatment) && event.category === "subscription")
    .reduce((sum: number, event: any) => sum + event.amountRub, 0);
  const storageHandlingExpense = round2(storageExpense + crossDockingExpense + inboundHandlingExpense);
  const otherChannelExpense = financeEvents
    .filter(
      (event: any) =>
        isChannelOperatingTreatment(event.treatment) &&
        !["ads", "storage", "cross_docking", "inbound_handling", "subscription"].includes(String(event.category ?? ""))
    )
    .reduce((sum: number, event: any) => sum + event.amountRub, 0);
  const channelOperatingExpenses = round2(
    adsExpense + storageExpense + crossDockingExpense + inboundHandlingExpense + subscriptionExpense + otherChannelExpense
  );
  const operatingExpenseRub = operatingExpenses.reduce((sum: number, expense: any) => sum + expense.amountRub, 0);
  const otherIncome = netCreditJournal(journalLines, "91.01");
  const otherExpense = netDebitJournal(journalLines, "91.02");
  const grossProfit = round2(revenue - costOfSales);
  const contributionProfit = round2(grossProfit - variableMarketplaceExpenses);
  const totalExpenses = round2(costOfSales + variableMarketplaceExpenses + channelOperatingExpenses + operatingExpenseRub + otherExpense);
  const netProfit = round2(contributionProfit - channelOperatingExpenses - operatingExpenseRub + otherIncome - otherExpense);
  const netMarginPercent = revenue > 0 ? round2((netProfit / revenue) * 100) : 0;

  const balancesToDate = accumulateBalances(state.journalEntries ?? [], state.journalLines ?? [], to);
  const ownerTransactions = state.ownerTransactions ?? [];
  const ownerContributions = ownerTransactions.filter((row: any) => row.transactionType === "contribution").reduce((sum: number, row: any) => sum + row.amountRub, 0);
  const ownerWithdrawals = ownerTransactions.filter((row: any) => row.transactionType === "withdrawal").reduce((sum: number, row: any) => sum + row.amountRub, 0);

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
      unpaidExpenses: (state.operatingExpenses ?? []).filter((expense: any) => expense.paymentStatus === "unpaid").reduce((sum: number, expense: any) => sum + expense.amountRub, 0),
      channelObligations: Math.max(0, creditBalance(balancesToDate["76.ТП"]) - debitBalance(balancesToDate["76.ТП"])),
      ownerContributions,
      ownerWithdrawals,
      retainedEarnings: netProfit,
      assets: debitBalance(balancesToDate["50"]) + debitBalance(balancesToDate["51"]) + debitBalance(balancesToDate["41.01"]) + debitBalance(balancesToDate["41.02"]) + debitBalance(balancesToDate["41.03"]) + debitBalance(balancesToDate["45.03"]) + debitBalance(balancesToDate["60.02"]) + debitBalance(balancesToDate["76.ТП"]),
      liabilities: creditBalance(balancesToDate["60.01"]) + Math.max(0, creditBalance(balancesToDate["76.ТП"]) - debitBalance(balancesToDate["76.ТП"])) + (state.operatingExpenses ?? []).filter((expense: any) => expense.paymentStatus === "unpaid").reduce((sum: number, expense: any) => sum + expense.amountRub, 0),
      equity: ownerContributions - ownerWithdrawals + netProfit
    },
    sales,
    unitRows
  };
}

function buildBalanceSnapshot(state: any, asOf: string) {
  const balancesToDate = accumulateBalances(state.journalEntries ?? [], state.journalLines ?? [], asOf);
  const chartAccounts = state.chartAccounts ?? [];
  const ownerContributions = creditBalance(balancesToDate["80.01"]);
  const ownerWithdrawals = debitBalance(balancesToDate["80.02"]);
  const retainedEarnings = buildAccumulatedResult(chartAccounts, balancesToDate);
  const cash = debitBalance(balancesToDate["50"]) + debitBalance(balancesToDate["51"]);
  const inventory = debitBalance(balancesToDate["41.01"]) + debitBalance(balancesToDate["41.02"]) + debitBalance(balancesToDate["41.03"]);
  const marketplaceAwaitingAccrual = debitBalance(balancesToDate["45.03"]);
  const supplierAdvances = debitBalance(balancesToDate["60.02"]);
  const supplierClaims = debitBalance(balancesToDate["76.02"]);
  const marketplaceReceivable = debitBalance(balancesToDate["76.ТП"]);
  const supplierPayables = creditBalance(balancesToDate["60.01"]);
  const unpaidExpenses = (state.operatingExpenses ?? [])
    .filter((expense: any) => expense.paymentStatus === "unpaid" && expense.expenseDate <= asOf)
    .reduce((sum: number, expense: any) => sum + Number(expense.amountRub ?? 0), 0);
  const channelObligations = creditBalance(balancesToDate["76.ТП"]);
  const assets = round2(cash + inventory + marketplaceAwaitingAccrual + supplierAdvances + supplierClaims + marketplaceReceivable);
  const liabilities = round2(supplierPayables + unpaidExpenses + channelObligations);
  const equity = round2(ownerContributions - ownerWithdrawals + retainedEarnings);
  const difference = round2(assets - liabilities - equity);
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
    difference
  };
}

function buildUnitRows(state: any, sales: any[], to: string) {
  const saleIds = new Set(sales.map((sale: any) => sale.id));
  const lines = (state.saleLines ?? []).filter((line: any) => saleIds.has(line.saleId));
  const channels = state.salesChannels ?? [];
  const products = state.products ?? [];
  const financeEvents = (state.channelFinanceEvents ?? []).filter((event: any) => event.occurredAt <= to && event.status === "posted");
  const salesById = new Map(sales.map((sale: any) => [sale.id, sale]));
  type VariableFinanceBreakdown = {
    commissionRub: number;
    acquiringRub: number;
    lastMileRub: number;
    returnLogisticsRub: number;
    otherVariableRub: number;
    categoryBreakdown: Map<string, number>;
  };
  const financeBySale = new Map<string, VariableFinanceBreakdown>();
  const settledThroughByChannel = buildVariableFinanceSettledThrough(financeEvents);

  financeEvents.forEach((event: any) => {
    if (!isVariableMarketplaceTreatment(event.treatment)) return;
    for (const allocation of channelFinanceSaleAllocations(event)) {
      const current: VariableFinanceBreakdown = financeBySale.get(allocation.saleId) ?? {
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
      current.categoryBreakdown.set(
        String(event.category ?? "other"),
        round2(Number(current.categoryBreakdown.get(String(event.category ?? "other")) ?? 0) + Number(allocation.amountRub ?? 0))
      );
      financeBySale.set(allocation.saleId, current);
    }
  });

  const grouped = new Map<string, any>();
  lines.forEach((line: any) => {
    const sale = salesById.get(line.saleId);
    if (!sale) return;
    const product = products.find((candidate: any) => candidate.id === line.productId);
    const channel = channels.find((candidate: any) => candidate.id === sale.channelId);
    const saleFees: VariableFinanceBreakdown = financeBySale.get(sale.id) ?? {
      commissionRub: 0,
      acquiringRub: 0,
      lastMileRub: 0,
      returnLogisticsRub: 0,
      otherVariableRub: 0,
      categoryBreakdown: new Map<string, number>()
    };
    const saleRevenue = saleRevenueRub(sale);
    const share = saleRevenue > 0 ? line.revenueRub / saleRevenue : 0;
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
    current.qtySold += line.qty;
    current.unsettledQty += isProvisionalSale ? line.qty : 0;
    current.revenueRub += line.revenueRub;
    current.unsettledRevenueRub += isProvisionalSale ? line.revenueRub : 0;
    current.costRub += line.costRub;
    current.commissionRub += round2(saleFees.commissionRub * share);
    current.acquiringRub += round2(saleFees.acquiringRub * share);
    current.lastMileRub += round2(saleFees.lastMileRub * share);
    current.returnLogisticsRub += round2(saleFees.returnLogisticsRub * share);
    current.logisticsRub = round2(current.lastMileRub + current.returnLogisticsRub);
    current.otherVariableRub += round2(saleFees.otherVariableRub * share);
    current.otherFeesRub = round2(current.otherVariableRub);
    for (const [category, amountRub] of saleFees.categoryBreakdown.entries()) {
      const currentCategory = current.categoryBreakdown.find((item: any) => item.category === category);
      const allocatedRub = round2(amountRub * share);
      if (currentCategory) currentCategory.amountRub = round2(currentCategory.amountRub + allocatedRub);
      else current.categoryBreakdown.push({ category, amountRub: allocatedRub });
    }
    current.variableFeesRub = round2(current.commissionRub + current.acquiringRub + current.logisticsRub + current.otherFeesRub);
    current.profitRub = round2(current.revenueRub - current.costRub - current.commissionRub - current.acquiringRub - current.logisticsRub - current.otherFeesRub);
    current.marginPercent = current.revenueRub > 0 ? round2((current.profitRub / current.revenueRub) * 100) : 0;
    current.roiPercent = current.costRub > 0 ? round2((current.profitRub / current.costRub) * 100) : 0;
    grouped.set(key, current);
  });

  return [...grouped.values()].sort((left, right) => right.revenueRub - left.revenueRub);
}

function buildFinanceLag(state: any, sales: any[], to: string) {
  const variableFinanceEvents = (state.channelFinanceEvents ?? []).filter((event: any) => event.occurredAt <= to && event.status === "posted" && isVariableMarketplaceTreatment(event.treatment));
  const settledThroughByChannel = buildVariableFinanceSettledThrough(variableFinanceEvents);
  const saleIds = new Set(sales.map((sale: any) => sale.id));
  const saleLines = (state.saleLines ?? []).filter((line: any) => saleIds.has(line.saleId));
  const saleLinesBySale = saleLines.reduce((acc: Map<string, any[]>, line: any) => {
    const bucket = acc.get(line.saleId) ?? [];
    bucket.push(line);
    acc.set(line.saleId, bucket);
    return acc;
  }, new Map<string, any[]>());
  const unsettledSales = sales.filter((sale: any) => {
    const settledThrough = settledThroughByChannel.get(sale.channelId);
    return !settledThrough || sale.saleDate > settledThrough;
  });
  const unsettledQty = round2(unsettledSales.reduce((sum: number, sale: any) => {
    const linesForSale = saleLinesBySale.get(sale.id) ?? [];
    return sum + linesForSale.reduce((lineSum: number, line: any) => lineSum + Number(line.qty ?? 0), 0);
  }, 0));
  const unsettledSalesRevenueRub = round2(unsettledSales.reduce((sum: number, sale: any) => sum + saleRevenueRub(sale), 0));
  return {
    unsettledSalesCount: unsettledSales.length,
    unsettledSalesRevenueRub,
    unsettledQty,
    settledThroughByChannel
  };
}

function buildVariableFinanceSettledThrough(financeEvents: any[]) {
  return financeEvents.reduce<Map<string, string>>((acc, event) => {
    if (!isVariableMarketplaceTreatment(event.treatment)) return acc;
    const current = acc.get(event.channelId);
    if (!current || String(event.occurredAt) > current) acc.set(event.channelId, String(event.occurredAt));
    return acc;
  }, new Map());
}

function accumulateBalances(entries: any[], lines: any[], to: string) {
  const entryIds = new Set(entries.filter((entry: any) => entry.accountingDate <= to).map((entry: any) => entry.id));
  return lines
    .filter((line: any) => entryIds.has(line.journalEntryId))
    .reduce<Record<string, { debit: number; credit: number }>>((acc, line) => {
      const current = acc[line.accountCode] ?? { debit: 0, credit: 0 };
      current.debit = round2(current.debit + Number(line.debit ?? 0));
      current.credit = round2(current.credit + Number(line.credit ?? 0));
      acc[line.accountCode] = current;
      return acc;
    }, {});
}

function buildAccumulatedResult(chartAccounts: any[], balances: Record<string, { debit: number; credit: number }>) {
  return round2(
    chartAccounts.reduce((sum: number, account: any) => {
      if (account.kind !== "revenue" && account.kind !== "expense") return sum;
      const balance = balances[account.code] ?? { debit: 0, credit: 0 };
      return sum + Number(balance.credit ?? 0) - Number(balance.debit ?? 0);
    }, 0)
  );
}

function saleRevenueRub(sale: any) {
  return Number(sale?.recognizedGrossAmountRub ?? sale?.grossAmountRub ?? 0);
}

function sumJournal(lines: any[], accountCode: string, side: "debit" | "credit") {
  return round2(lines.filter((line: any) => line.accountCode === accountCode).reduce((sum: number, line: any) => sum + Number(line[side] ?? 0), 0));
}

function netDebitJournal(lines: any[], accountCode: string) {
  return round2(sumJournal(lines, accountCode, "debit") - sumJournal(lines, accountCode, "credit"));
}

function netCreditJournal(lines: any[], accountCode: string) {
  return round2(sumJournal(lines, accountCode, "credit") - sumJournal(lines, accountCode, "debit"));
}

function debitBalance(balance?: { debit: number; credit: number }) {
  return Math.max(0, round2((balance?.debit ?? 0) - (balance?.credit ?? 0)));
}

function creditBalance(balance?: { debit: number; credit: number }) {
  return Math.max(0, round2((balance?.credit ?? 0) - (balance?.debit ?? 0)));
}

function firstDayOfMonth(dateValue: Date) {
  return formatLocalDate(new Date(dateValue.getFullYear(), dateValue.getMonth(), 1));
}

function lastDayOfMonth(dateValue: Date) {
  return formatLocalDate(new Date(dateValue.getFullYear(), dateValue.getMonth() + 1, 0));
}

function endOfPreviousMonth(dateValue: Date) {
  return formatLocalDate(new Date(dateValue.getFullYear(), dateValue.getMonth(), 0));
}

function formatPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function sum<T extends Record<string, number>>(rows: T[], key: keyof T) {
  return round2(rows.reduce((acc, row) => acc + Number(row[key] ?? 0), 0));
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return round2(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function unitRowKey(row: { product?: { id?: string }; channel?: { id?: string } }) {
  return `${row.product?.id ?? "na"}:${row.channel?.id ?? "na"}`;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function formatLocalDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

type BalanceTableRow = {
  key: BalanceMetricKey;
  label: string;
  current: number;
  compare?: number;
  emphasis?: boolean;
};

type BalanceMetricKey =
  | "cash"
  | "inventory"
  | "marketplaceAwaitingAccrual"
  | "supplierAdvances"
  | "supplierClaims"
  | "marketplaceReceivable"
  | "assets"
  | "supplierPayables"
  | "unpaidExpenses"
  | "channelObligations"
  | "liabilities"
  | "ownerContributions"
  | "ownerWithdrawals"
  | "retainedEarnings"
  | "equity";

type BalanceDrilldownComponent = {
  id: string;
  label: string;
  source: string;
  accountCode?: string;
  accountMode?: "debit" | "credit" | "signed";
  sign?: number;
  current: number;
  compare?: number;
};

type BalanceDrilldownDocument = {
  documentId: string;
  number: string;
  title: string;
  accountingDate: string;
  effectRub: number;
  sources: string[];
};

type BalanceDrilldownJournalRow = {
  journalEntryId: string;
  documentId?: string;
  documentNumber?: string;
  accountingDate: string;
  accountCode: string;
  memo: string;
  debit: number;
  credit: number;
  effectRub: number;
};

type BalanceDrilldown = {
  key: BalanceMetricKey;
  label: string;
  description: string;
  currentDate: string;
  compareDate?: string;
  current: number;
  compare?: number;
  delta?: number;
  components: BalanceDrilldownComponent[];
  documents: BalanceDrilldownDocument[];
  journalRows: BalanceDrilldownJournalRow[];
};

function BalanceTable({
  currentDate,
  compareDate,
  rows,
  onSelect
}: {
  currentDate: string;
  compareDate?: string;
  rows: BalanceTableRow[];
  onSelect?: (key: BalanceMetricKey) => void;
}) {
  return (
    <Table>
      <THead>
        <TR>
          <TH>Статья</TH>
          <TH numeric>{date(currentDate)}</TH>
          {compareDate ? <TH numeric>{date(compareDate)}</TH> : null}
          {compareDate ? <TH numeric>Изменение</TH> : null}
        </TR>
      </THead>
      <TBody>
        {rows.map((row) => {
          const delta = compareDate ? round2(row.current - Number(row.compare ?? 0)) : 0;
          const deltaClassName = delta === 0 ? "text-[var(--color-muted-foreground)]" : "font-medium";
          const interactive = Boolean(onSelect);
          return (
            <TR
              key={row.key}
              interactive={interactive}
              onClick={interactive ? () => onSelect?.(row.key) : undefined}
              className={row.emphasis ? "bg-[var(--color-muted)]/30" : undefined}
            >
              <TD className={row.emphasis ? "font-semibold" : undefined}>
                <div className="flex items-center gap-2">
                  <span>{row.label}</span>
                  {interactive ? <ArrowUpRight size={13} className="text-[var(--color-muted-foreground)]" /> : null}
                </div>
              </TD>
              <TD numeric className={row.emphasis ? "font-semibold" : undefined}>{rub(row.current, { precise: true })}</TD>
              {compareDate ? <TD numeric>{rub(row.compare ?? 0, { precise: true })}</TD> : null}
              {compareDate ? (
                <TD numeric className={deltaClassName}>
                  {delta > 0 ? "+" : ""}
                  {rub(delta, { precise: true })}
                </TD>
              ) : null}
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}

function BalanceDrilldownDialog({
  open,
  onOpenChange,
  drilldown
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  drilldown: BalanceDrilldown | null;
}) {
  if (!drilldown) return null;
  const [documentPage, setDocumentPage] = useState(1);
  const [documentPageSize, setDocumentPageSize] = useState(25);
  const [journalPage, setJournalPage] = useState(1);
  const [journalPageSize, setJournalPageSize] = useState(25);

  useEffect(() => {
    setDocumentPage(1);
    setJournalPage(1);
  }, [drilldown.key, drilldown.currentDate, drilldown.compareDate]);

  const pagedDocuments = useMemo(
    () => paginateRows(drilldown.documents, documentPage, documentPageSize),
    [documentPage, documentPageSize, drilldown.documents]
  );
  const pagedJournalRows = useMemo(
    () => paginateRows(drilldown.journalRows, journalPage, journalPageSize),
    [drilldown.journalRows, journalPage, journalPageSize]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{drilldown.label}</DialogTitle>
          <DialogDescription>{drilldown.description}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex max-h-[80vh] flex-col gap-4 overflow-hidden">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Info label={`На ${date(drilldown.currentDate)}`} value={rub(drilldown.current, { precise: true })} />
            {drilldown.compareDate ? <Info label={`На ${date(drilldown.compareDate)}`} value={rub(drilldown.compare ?? 0, { precise: true })} /> : null}
            {drilldown.compareDate ? (
              <Info
                label="Изменение"
                value={
                  <>
                    {Number(drilldown.delta ?? 0) > 0 ? "+" : ""}
                    {rub(drilldown.delta ?? 0, { precise: true })}
                  </>
                }
              />
            ) : null}
          </div>

          <Tabs defaultValue="components" className="min-h-0 flex-1">
            <TabsList>
              <TabsTrigger value="components">Формула</TabsTrigger>
              <TabsTrigger value="documents">Документы</TabsTrigger>
              <TabsTrigger value="journal">Проводки</TabsTrigger>
            </TabsList>

            <TabsContent value="components" className="min-h-0">
              <Card>
                <CardContent className="max-h-[54vh] overflow-auto p-0">
                  <Table>
                    <THead>
                      <TR>
                        <TH>Компонент</TH>
                        <TH>Источник</TH>
                        <TH numeric>{date(drilldown.currentDate)}</TH>
                        {drilldown.compareDate ? <TH numeric>{date(drilldown.compareDate)}</TH> : null}
                        {drilldown.compareDate ? <TH numeric>Изменение</TH> : null}
                      </TR>
                    </THead>
                    <TBody>
                      {drilldown.components.map((row) => {
                        const delta = drilldown.compareDate ? round2(row.current - Number(row.compare ?? 0)) : 0;
                        return (
                          <TR key={row.id}>
                            <TD className="font-medium">{row.label}</TD>
                            <TD className="text-[var(--color-muted-foreground)]">{row.source}</TD>
                            <TD numeric>{rub(row.current, { precise: true })}</TD>
                            {drilldown.compareDate ? <TD numeric>{rub(row.compare ?? 0, { precise: true })}</TD> : null}
                            {drilldown.compareDate ? (
                              <TD numeric className={delta === 0 ? "text-[var(--color-muted-foreground)]" : "font-medium"}>
                                {delta > 0 ? "+" : ""}
                                {rub(delta, { precise: true })}
                              </TD>
                            ) : null}
                          </TR>
                        );
                      })}
                    </TBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="documents" className="min-h-0">
              <Card>
                <CardContent className="max-h-[54vh] overflow-auto p-0">
                  <Table>
                    <THead>
                      <TR>
                        <TH>Документ</TH>
                        <TH>Дата</TH>
                        <TH>Откуда вошёл</TH>
                        <TH numeric>Влияние</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {drilldown.documents.length === 0 ? (
                        <TR><TD colSpan={4} className="py-10 text-center text-[var(--color-muted-foreground)]">Подходящих документов нет.</TD></TR>
                      ) : (
                        pagedDocuments.map((row) => (
                          <TR key={row.documentId}>
                            <TD>
                              <div className="flex flex-col gap-1">
                                <Link to={`/documents/${row.documentId}`} className="font-mono text-sm font-semibold text-[var(--color-primary)] hover:underline">
                                  {row.number}
                                </Link>
                                <span className="text-sm">{row.title}</span>
                              </div>
                            </TD>
                            <TD>{date(row.accountingDate)}</TD>
                            <TD className="text-[var(--color-muted-foreground)]">{row.sources.join(", ")}</TD>
                            <TD numeric className={row.effectRub === 0 ? "text-[var(--color-muted-foreground)]" : "font-medium"}>
                              {row.effectRub > 0 ? "+" : ""}
                              {rub(row.effectRub, { precise: true })}
                            </TD>
                          </TR>
                        ))
                      )}
                    </TBody>
                  </Table>
                </CardContent>
                {drilldown.documents.length > 0 ? (
                  <Pagination
                    page={documentPage}
                    pageSize={documentPageSize}
                    total={drilldown.documents.length}
                    onPageChange={setDocumentPage}
                    onPageSizeChange={(size) => {
                      setDocumentPageSize(size);
                      setDocumentPage(1);
                    }}
                  />
                ) : null}
              </Card>
            </TabsContent>

            <TabsContent value="journal" className="min-h-0">
              <Card>
                <CardContent className="max-h-[54vh] overflow-auto p-0">
                  <Table>
                    <THead>
                      <TR>
                        <TH>Дата</TH>
                        <TH>Счёт</TH>
                        <TH>Документ</TH>
                        <TH>Смысл</TH>
                        <TH numeric>Дт</TH>
                        <TH numeric>Кт</TH>
                        <TH numeric>Влияние</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {drilldown.journalRows.length === 0 ? (
                        <TR><TD colSpan={7} className="py-10 text-center text-[var(--color-muted-foreground)]">По этой статье нет отдельных проводок. Значение собрано из статусов и карточек документов.</TD></TR>
                      ) : (
                        pagedJournalRows.map((row) => (
                          <TR key={`${row.journalEntryId}:${row.accountCode}:${row.memo}:${row.debit}:${row.credit}`}>
                            <TD>{date(row.accountingDate)}</TD>
                            <TD className="font-mono text-sm">{row.accountCode}</TD>
                            <TD>
                              {row.documentId && row.documentNumber ? (
                                <Link to={`/documents/${row.documentId}`} className="font-mono text-sm font-semibold text-[var(--color-primary)] hover:underline">
                                  {row.documentNumber}
                                </Link>
                              ) : (
                                "—"
                              )}
                            </TD>
                            <TD className="text-[var(--color-muted-foreground)]">{row.memo}</TD>
                            <TD numeric>{rub(row.debit, { precise: true })}</TD>
                            <TD numeric>{rub(row.credit, { precise: true })}</TD>
                            <TD numeric className={row.effectRub === 0 ? "text-[var(--color-muted-foreground)]" : "font-medium"}>
                              {row.effectRub > 0 ? "+" : ""}
                              {rub(row.effectRub, { precise: true })}
                            </TD>
                          </TR>
                        ))
                      )}
                    </TBody>
                  </Table>
                </CardContent>
                {drilldown.journalRows.length > 0 ? (
                  <Pagination
                    page={journalPage}
                    pageSize={journalPageSize}
                    total={drilldown.journalRows.length}
                    onPageChange={setJournalPage}
                    onPageSizeChange={(size) => {
                      setJournalPageSize(size);
                      setJournalPage(1);
                    }}
                  />
                ) : null}
              </Card>
            </TabsContent>
          </Tabs>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function buildBalanceDrilldown(state: any, key: BalanceMetricKey, asOf: string, compareAsOf?: string): BalanceDrilldown {
  const entries = state.journalEntries ?? [];
  const lines = state.journalLines ?? [];
  const documents = state.documents ?? [];
  const chartAccounts = state.chartAccounts ?? [];
  const balances = accumulateBalances(entries, lines, asOf);
  const compareBalances = compareAsOf ? accumulateBalances(entries, lines, compareAsOf) : undefined;
  const documentById = new Map<string, any>(documents.map((document: any) => [document.id, document]));
  const entryById = new Map<string, any>(
    entries
      .filter((entry: any) => entry.accountingDate <= asOf)
      .map((entry: any) => [entry.id, entry])
  );
  const metricRows = buildBalanceMetricRows(state, chartAccounts, balances, compareBalances, asOf, compareAsOf);
  const metricRow = metricRows.get(key);
  if (!metricRow) {
    return {
      key,
      label: "Статья баланса",
      description: "Расшифровка недоступна.",
      currentDate: asOf,
      compareDate: compareAsOf,
      current: 0,
      compare: compareAsOf ? 0 : undefined,
      delta: compareAsOf ? 0 : undefined,
      components: [],
      documents: [],
      journalRows: []
    };
  }

  const journalRows = metricRow.components
    .flatMap((component) => buildJournalRowsForComponent(component, lines, entryById, documentById))
    .sort((left, right) => {
      if (left.accountingDate === right.accountingDate) return Math.abs(right.effectRub) - Math.abs(left.effectRub);
      return String(right.accountingDate).localeCompare(String(left.accountingDate));
    });

  const documentsFromJournal = aggregateDocumentsFromJournal(journalRows, documentById);
  const documentsFromRegistry = metricRow.components
    .flatMap((component) => buildRegistryDocumentsForComponent(component, state, asOf))
    .reduce<Map<string, BalanceDrilldownDocument>>((acc, row) => {
      const current = acc.get(row.documentId);
      if (current) {
        current.effectRub = round2(current.effectRub + row.effectRub);
        current.sources = [...new Set([...current.sources, ...row.sources])];
      } else {
        acc.set(row.documentId, { ...row, sources: [...row.sources] });
      }
      return acc;
    }, new Map());

  for (const row of documentsFromJournal) {
    const current = documentsFromRegistry.get(row.documentId);
    if (current) {
      current.effectRub = round2(current.effectRub + row.effectRub);
      current.sources = [...new Set([...current.sources, ...row.sources])];
    } else {
      documentsFromRegistry.set(row.documentId, row);
    }
  }

  const documentsSorted = [...documentsFromRegistry.values()]
    .sort((left, right) => Math.abs(right.effectRub) - Math.abs(left.effectRub) || String(right.accountingDate).localeCompare(String(left.accountingDate)));

  return {
    key,
    label: metricRow.label,
    description: metricRow.description,
    currentDate: asOf,
    compareDate: compareAsOf,
    current: metricRow.current,
    compare: metricRow.compare,
    delta: compareAsOf ? round2(metricRow.current - Number(metricRow.compare ?? 0)) : undefined,
    components: metricRow.components,
    documents: documentsSorted,
    journalRows
  };
}

function buildBalanceMetricRows(
  state: any,
  chartAccounts: any[],
  balances: Record<string, { debit: number; credit: number }>,
  compareBalances: Record<string, { debit: number; credit: number }> | undefined,
  asOf: string,
  compareAsOf?: string
) {
  const rows = new Map<
    BalanceMetricKey,
    {
      label: string;
      description: string;
      current: number;
      compare?: number;
      components: BalanceDrilldownComponent[];
    }
  >();

  const pushMetric = (
    key: BalanceMetricKey,
    label: string,
    description: string,
    components: BalanceDrilldownComponent[]
  ) => {
    rows.set(key, {
      label,
      description,
      current: round2(components.reduce((sum, component) => sum + component.current, 0)),
      compare: compareAsOf ? round2(components.reduce((sum, component) => sum + Number(component.compare ?? 0), 0)) : undefined,
      components
    });
  };

  const accountComponent = (
    id: string,
    label: string,
    accountCode: string,
    mode: "debit" | "credit" | "signed",
    source?: string,
    sign = 1
  ): BalanceDrilldownComponent => {
    const currentRaw = mode === "debit" ? debitBalance(balances[accountCode]) : mode === "credit" ? creditBalance(balances[accountCode]) : round2(Number(balances[accountCode]?.credit ?? 0) - Number(balances[accountCode]?.debit ?? 0));
    const compareRaw = compareBalances
      ? mode === "debit"
        ? debitBalance(compareBalances[accountCode])
        : mode === "credit"
          ? creditBalance(compareBalances[accountCode])
          : round2(Number(compareBalances[accountCode]?.credit ?? 0) - Number(compareBalances[accountCode]?.debit ?? 0))
      : undefined;
    return {
      id,
      label,
      source: source ?? sourceLabelForAccount(accountCode, mode, chartAccounts),
      accountCode,
      accountMode: mode,
      sign,
      current: round2(currentRaw * sign),
      compare: compareRaw !== undefined ? round2(compareRaw * sign) : undefined
    };
  };

  const unpaidExpenseComponent = (): BalanceDrilldownComponent => ({
    id: "unpaid-operating-expenses",
    label: "Неоплаченные операционные расходы",
    source: "Карточки операционных расходов со статусом unpaid",
    current: unpaidExpensesAsOf(state, asOf),
    compare: compareAsOf ? unpaidExpensesAsOf(state, compareAsOf) : undefined
  });

  const retainedComponents = chartAccounts
    .filter((account: any) => account.kind === "revenue" || account.kind === "expense")
    .map((account: any) => accountComponent(`retained-${account.code}`, account.name, account.code, "signed", `${account.kind === "revenue" ? "Доходный" : "Расходный"} счет ${account.code}`))
    .filter((component) => Math.abs(component.current) > 0.0001 || Math.abs(Number(component.compare ?? 0)) > 0.0001);

  pushMetric("cash", "Денежные средства", "Сумма остатков на денежных счетах компании на выбранную дату.", [
    accountComponent("cash-50", "Касса", "50", "debit"),
    accountComponent("cash-51", "Расчетный счет", "51", "debit")
  ]);
  pushMetric("inventory", "Товары в наличии", "Себестоимость товаров, которые ещё лежат на складе, в пути или на точках продаж.", [
    accountComponent("inventory-41.01", "Товары на своем складе", "41.01", "debit"),
    accountComponent("inventory-41.02", "Товары в пути", "41.02", "debit"),
    accountComponent("inventory-41.03", "Товары на точках продаж", "41.03", "debit")
  ]);
  pushMetric("marketplaceAwaitingAccrual", "Продажи ждут начисления", "Себестоимость товаров, которые уже списаны по заказам маркетплейса, но ещё не попали в его начисления.", [
    accountComponent(
      "marketplace-awaiting-accrual-45.03",
      "Продажи ждут начисления",
      "45.03",
      "debit",
      "Заказы уже списали товар, начисление маркетплейса ещё не пришло"
    )
  ]);
  pushMetric("supplierAdvances", "Авансы поставщикам", "Дебетовое сальдо по авансам, выданным поставщикам.", [
    accountComponent("advances-60.02", "Авансы поставщикам", "60.02", "debit")
  ]);
  pushMetric("supplierClaims", "Претензии поставщикам", "Дебетовое сальдо по претензиям и требованиям к поставщикам.", [
    accountComponent("claims-76.02", "Претензии поставщикам", "76.02", "debit")
  ]);
  pushMetric("marketplaceReceivable", "Дебиторка маркетплейсов", "Сколько маркетплейсы ещё должны компании: продажи увеличивают показатель, комиссии и выплаты уменьшают.", [
    accountComponent("marketplace-76tp-debit", "Расчеты с точками продаж", "76.ТП", "debit")
  ]);
  pushMetric("assets", "Активы", "Все активы, которые формируют левую сторону баланса на выбранную дату.", [
    ...rows.get("cash")!.components,
    ...rows.get("inventory")!.components,
    ...rows.get("marketplaceAwaitingAccrual")!.components,
    ...rows.get("supplierAdvances")!.components,
    ...rows.get("supplierClaims")!.components,
    ...rows.get("marketplaceReceivable")!.components
  ]);
  pushMetric("supplierPayables", "Кредиторка поставщикам", "Сколько компания должна поставщикам по проведённым закупочным и операционным документам.", [
    accountComponent("payables-60.01", "Задолженность поставщикам", "60.01", "credit")
  ]);
  pushMetric("unpaidExpenses", "Неоплаченные расходы", "Операционные расходы, которые заведены без немедленной оплаты и ещё не закрыты.", [
    unpaidExpenseComponent()
  ]);
  pushMetric("channelObligations", "Обязательства по каналам", "Кредитовое сальдо по расчетам с каналами, если площадка стала кредитором.", [
    accountComponent("channel-76tp-credit", "Расчеты с точками продаж", "76.ТП", "credit")
  ]);
  pushMetric("liabilities", "Обязательства", "Все обязательства компании на выбранную дату.", [
    ...rows.get("supplierPayables")!.components,
    ...rows.get("unpaidExpenses")!.components,
    ...rows.get("channelObligations")!.components
  ]);
  pushMetric("ownerContributions", "Вложения владельца", "Деньги и имущество, которые владелец внес в бизнес.", [
    accountComponent("equity-80.01", "Вклады владельца", "80.01", "credit")
  ]);
  pushMetric("ownerWithdrawals", "Изъятия владельца", "Средства, которые владелец вывел из бизнеса.", [
    accountComponent("equity-80.02", "Изъятия владельца", "80.02", "debit")
  ]);
  pushMetric("retainedEarnings", "Накопленный результат", "Накопленная прибыль или убыток по всем доходным и расходным счетам на выбранную дату.", retainedComponents);
  pushMetric("equity", "Капитал", "Источники собственного финансирования: вложения владельца, изъятия и накопленный результат.", [
    ...rows.get("ownerContributions")!.components,
    accountComponent("equity-withdrawals-negative", "Изъятия владельца", "80.02", "debit", "Контрсчет капитала 80.02", -1),
    ...rows.get("retainedEarnings")!.components
  ]);
  return rows;
}

function buildJournalRowsForComponent(
  component: BalanceDrilldownComponent,
  lines: any[],
  entryById: Map<string, any>,
  documentById: Map<string, any>
): BalanceDrilldownJournalRow[] {
  if (!component.accountCode || !component.accountMode) return [];
  return lines
    .filter((line: any) => line.accountCode === component.accountCode && entryById.has(line.journalEntryId))
    .map((line: any) => {
      const entry = entryById.get(line.journalEntryId);
      const document = documentById.get(entry?.documentId);
      const effectRub =
        (component.accountMode === "debit"
          ? round2(Number(line.debit ?? 0) - Number(line.credit ?? 0))
          : component.accountMode === "credit"
            ? round2(Number(line.credit ?? 0) - Number(line.debit ?? 0))
            : round2(Number(line.credit ?? 0) - Number(line.debit ?? 0))) * Number(component.sign ?? 1);
      return {
        journalEntryId: line.journalEntryId,
        documentId: entry?.documentId,
        documentNumber: document?.number,
        accountingDate: entry?.accountingDate ?? "",
        accountCode: line.accountCode,
        memo: line.memo,
        debit: Number(line.debit ?? 0),
        credit: Number(line.credit ?? 0),
        effectRub
      };
    })
    .filter((row) => Math.abs(row.effectRub) > 0.0001);
}

function aggregateDocumentsFromJournal(rows: BalanceDrilldownJournalRow[], documentById: Map<string, any>): BalanceDrilldownDocument[] {
  const documents = new Map<string, BalanceDrilldownDocument>();
  for (const row of rows) {
    if (!row.documentId || !row.documentNumber) continue;
    const document = documentById.get(row.documentId);
    const current = documents.get(row.documentId);
    if (current) {
      current.effectRub = round2(current.effectRub + row.effectRub);
      current.sources = [...new Set([...current.sources, row.accountCode])];
    } else {
      documents.set(row.documentId, {
        documentId: row.documentId,
        number: row.documentNumber,
        title: document?.title ?? "",
        accountingDate: row.accountingDate,
        effectRub: row.effectRub,
        sources: [row.accountCode]
      });
    }
  }
  return [...documents.values()];
}

function buildRegistryDocumentsForComponent(component: BalanceDrilldownComponent, state: any, asOf: string): BalanceDrilldownDocument[] {
  if (component.id !== "unpaid-operating-expenses") return [];
  const documentsById = new Map<string, any>((state.documents ?? []).map((document: any) => [document.id, document]));
  return (state.operatingExpenses ?? [])
    .filter((expense: any) => expense.paymentStatus === "unpaid" && expense.expenseDate <= asOf)
    .map((expense: any) => {
      const document = documentsById.get(expense.documentId);
      return {
        documentId: expense.documentId,
        number: document?.number ?? expense.documentId,
        title: document?.title ?? "Операционный расход",
        accountingDate: expense.expenseDate,
        effectRub: Number(expense.amountRub ?? 0),
        sources: ["Неоплаченные расходы"]
      };
    });
}

function unpaidExpensesAsOf(state: any, asOf: string) {
  return round2(
    (state.operatingExpenses ?? [])
      .filter((expense: any) => expense.paymentStatus === "unpaid" && expense.expenseDate <= asOf)
      .reduce((sum: number, expense: any) => sum + Number(expense.amountRub ?? 0), 0)
  );
}

function sourceLabelForAccount(accountCode: string, mode: "debit" | "credit" | "signed", chartAccounts: any[]) {
  const account = chartAccounts.find((item: any) => item.code === accountCode);
  const sideLabel = mode === "debit" ? "дебетовое сальдо" : mode === "credit" ? "кредитовое сальдо" : "чистый вклад счета";
  return `${account?.name ?? accountCode} · ${accountCode} · ${sideLabel}`;
}

type PnlDocumentRef = {
  id: string;
  number: string;
  title: string;
  accountingDate: string;
  amountRub: number;
};

type PnlTreeNode = {
  id: string;
  label: string;
  amountRub: number;
  note?: string;
  documents: PnlDocumentRef[];
  children: PnlTreeNode[];
  tone?: "neutral" | "primary" | "success" | "warning" | "danger" | "info";
};

function buildPnlTree(state: any, current: ReturnType<typeof buildReportData>): PnlTreeNode[] {
  const documentsById = new Map<string, any>((state.documents ?? []).map((document: any) => [document.id, document]));
  const journalEntriesById = new Map<string, any>((current.journalEntries ?? []).map((entry: any) => [entry.id, entry]));
  const revenueDocs = buildJournalDocumentRefs(current.journalLines, journalEntriesById, documentsById, { accountCode: "90.01", mode: "credit" });
  const costOfSalesDocs = buildJournalDocumentRefs(current.journalLines, journalEntriesById, documentsById, { accountCode: "90.02", mode: "debit" });
  const otherIncomeDocs = buildJournalDocumentRefs(current.journalLines, journalEntriesById, documentsById, { accountCode: "91.01", mode: "credit" });
  const otherExpenseDocs = buildJournalDocumentRefs(current.journalLines, journalEntriesById, documentsById, { accountCode: "91.02", mode: "debit" });
  const financeDocs = (predicate: (event: any) => boolean) => buildFinanceEventDocumentRefs(current.financeEvents, documentsById, predicate);

  const commissionNode = createPnlLeaf(
    "marketplace-commission",
    "Комиссия маркетплейса",
    current.pnl.commissionExpense,
    "Базовая комиссия за продажу товаров на площадке.",
    financeDocs((event) => isVariableMarketplaceTreatment(event.treatment) && event.category === "commission")
  );
  const acquiringNode = createPnlLeaf(
    "marketplace-acquiring",
    "Эквайринг",
    current.pnl.acquiringExpense,
    "Удержания за обработку оплаты покупателя.",
    financeDocs((event) => isVariableMarketplaceTreatment(event.treatment) && event.category === "acquiring")
  );
  const lastMileNode = createPnlLeaf(
    "marketplace-last-mile",
    "Доставка до покупателя",
    current.pnl.lastMileExpense,
    "Логистика последней мили по фактическим продажам.",
    financeDocs((event) => isVariableMarketplaceTreatment(event.treatment) && event.category === "last_mile_logistics")
  );
  const returnLogisticsNode = createPnlLeaf(
    "marketplace-return-logistics",
    "Логистика возвратов",
    current.pnl.returnLogisticsExpense,
    "Расходы маркетплейса на обратную логистику.",
    financeDocs((event) => isVariableMarketplaceTreatment(event.treatment) && event.category === "return_logistics")
  );
  const otherVariableNode = createPnlLeaf(
    "marketplace-other-variable",
    "Прочие удержания по продажам",
    current.pnl.otherVariableMarketplaceExpense,
    "Редкие удержания, которые площадка привязывает к конкретным продажам.",
    financeDocs(
      (event) =>
        isVariableMarketplaceTreatment(event.treatment) &&
        !["commission", "acquiring", "last_mile_logistics", "return_logistics"].includes(String(event.category ?? ""))
    )
  );
  const variableMarketplaceNode = createPnlBranch(
    "marketplace-variable",
    "Расходы маркетплейса по продажам",
    current.pnl.variableMarketplaceExpenses,
    "Все расходы маркетплейса, которые относятся прямо к проданным заказам.",
    [commissionNode, acquiringNode, lastMileNode, returnLogisticsNode, otherVariableNode]
  );
  const adsNode = createPnlLeaf(
    "channel-ads",
    "Реклама и продвижение",
    current.pnl.adsExpense,
    "Промо, трафареты и другие рекламные списания канала.",
    financeDocs((event) => isChannelOperatingTreatment(event.treatment) && event.category === "ads")
  );
  const storageNode = createPnlLeaf(
    "channel-storage",
    "Хранение",
    current.pnl.storageExpense,
    "Плата за хранение товаров на складе площадки.",
    financeDocs((event) => isChannelOperatingTreatment(event.treatment) && event.category === "storage")
  );
  const crossDockingNode = createPnlLeaf(
    "channel-cross-docking",
    "Кросс-докинг",
    current.pnl.crossDockingExpense,
    "Расходы на перегрузку и внутренние перемещения площадки.",
    financeDocs((event) => isChannelOperatingTreatment(event.treatment) && event.category === "cross_docking")
  );
  const inboundNode = createPnlLeaf(
    "channel-inbound",
    "Приемка и подготовка",
    current.pnl.inboundHandlingExpense,
    "Приемка, маркировка и подготовка товара на стороне маркетплейса.",
    financeDocs((event) => isChannelOperatingTreatment(event.treatment) && event.category === "inbound_handling")
  );
  const subscriptionNode = createPnlLeaf(
    "channel-subscription",
    "Подписки и тарифы",
    current.pnl.subscriptionExpense,
    "Регулярные платежи за тарифы и сервисы канала.",
    financeDocs((event) => isChannelOperatingTreatment(event.treatment) && event.category === "subscription")
  );
  const otherChannelNode = createPnlLeaf(
    "channel-other",
    "Прочие расходы канала",
    current.pnl.otherChannelExpense,
    "Операционные списания площадки, которые не относятся к конкретной продаже.",
    financeDocs(
      (event) =>
        isChannelOperatingTreatment(event.treatment) &&
        !["ads", "storage", "cross_docking", "inbound_handling", "subscription"].includes(String(event.category ?? ""))
    )
  );
  const channelOperatingNode = createPnlBranch(
    "channel-operating",
    "Прочие расходы по маркетплейсу",
    current.pnl.channelOperatingExpenses,
    "Расходы канала, которые влияют на прибыль периода, но не относятся к одной продаже.",
    [adsNode, storageNode, crossDockingNode, inboundNode, subscriptionNode, otherChannelNode]
  );
  const operatingExpensesNode = createPnlLeaf(
    "operating-expenses",
    "Операционные расходы бизнеса",
    current.pnl.operatingExpenses,
    "Расходы вне маркетплейса: аренда, услуги, зарплата и прочие затраты компании.",
    buildOperatingExpenseDocumentRefs(current.operatingExpenses, documentsById)
  );
  const otherExpenseNode = createPnlLeaf(
    "other-expenses",
    "Прочие расходы",
    current.pnl.otherExpense,
    "Корректировки и разовые списания, которые не входят в обычные продажи.",
    otherExpenseDocs
  );
  const incomeNode = createPnlBranch(
    "income",
    "Доходы",
    round2(current.pnl.revenue + current.pnl.otherIncome),
    "Все доходы периода: продажи и прочие поступления в отчет о прибыли и убытках.",
    [
      createPnlLeaf("revenue", "Выручка от продаж", current.pnl.revenue, "Продажи за выбранный период.", revenueDocs, "success"),
      createPnlLeaf("other-income", "Прочие доходы", current.pnl.otherIncome, "Доходы вне обычных продаж.", otherIncomeDocs)
    ],
    "success"
  );
  const expensesNode = createPnlBranch(
    "expenses",
    "Расходы",
    current.pnl.totalExpenses,
    "Все затраты периода: товар, удержания маркетплейса и прочие расходы компании.",
    [
      createPnlLeaf("cost-of-sales", "Себестоимость товара", current.pnl.costOfSales, "Списанная себестоимость проданных товаров.", costOfSalesDocs, "warning"),
      variableMarketplaceNode,
      channelOperatingNode,
      operatingExpensesNode,
      otherExpenseNode
    ],
    "warning"
  );
  const netProfitNode = createPnlLeaf(
    "net-profit",
    "Чистая прибыль",
    current.pnl.netProfit,
    "Что осталось после всех расходов периода.",
    mergePnlDocumentRefs(incomeNode.documents, expensesNode.documents),
    current.pnl.netProfit >= 0 ? "success" : "danger"
  );
  return [incomeNode, expensesNode, netProfitNode];
}

function createPnlLeaf(
  id: string,
  label: string,
  amountRub: number,
  note: string,
  documents: PnlDocumentRef[],
  tone: PnlTreeNode["tone"] = "neutral"
): PnlTreeNode {
  return { id, label, amountRub: round2(amountRub), note, documents: sortPnlDocuments(documents), children: [], tone };
}

function createPnlBranch(
  id: string,
  label: string,
  amountRub: number,
  note: string,
  children: PnlTreeNode[],
  tone: PnlTreeNode["tone"] = "neutral"
): PnlTreeNode {
  const visibleChildren = children.filter((child) => Math.abs(child.amountRub) > 0.0001 || child.children.length > 0 || child.documents.length > 0);
  return {
    id,
    label,
    amountRub: round2(amountRub),
    note,
    documents: mergePnlDocumentRefs(...visibleChildren.map((child) => child.documents)),
    children: visibleChildren,
    tone
  };
}

function sortPnlDocuments(documents: PnlDocumentRef[]) {
  return [...documents].sort(
    (left, right) =>
      Math.abs(right.amountRub) - Math.abs(left.amountRub) || String(right.accountingDate).localeCompare(String(left.accountingDate))
  );
}

function mergePnlDocumentRefs(...groups: PnlDocumentRef[][]): PnlDocumentRef[] {
  const merged = new Map<string, PnlDocumentRef>();
  for (const group of groups) {
    for (const document of group) {
      const current = merged.get(document.id);
      if (current) current.amountRub = round2(current.amountRub + document.amountRub);
      else merged.set(document.id, { ...document });
    }
  }
  return sortPnlDocuments([...merged.values()]);
}

function buildJournalDocumentRefs(
  journalLines: any[],
  journalEntriesById: Map<string, any>,
  documentsById: Map<string, any>,
  options: { accountCode: string; mode: "debit" | "credit" | "signed" }
) {
  const rows = new Map<string, PnlDocumentRef>();
  for (const line of journalLines) {
    if (line.accountCode !== options.accountCode) continue;
    const entry = journalEntriesById.get(line.journalEntryId);
    if (!entry?.documentId) continue;
    const document = documentsById.get(entry.documentId);
    const amountRub =
      options.mode === "debit"
        ? round2(Number(line.debit ?? 0) - Number(line.credit ?? 0))
        : round2(Number(line.credit ?? 0) - Number(line.debit ?? 0));
    if (Math.abs(amountRub) < 0.0001) continue;
    const current = rows.get(entry.documentId);
    if (current) current.amountRub = round2(current.amountRub + amountRub);
    else {
      rows.set(entry.documentId, {
        id: entry.documentId,
        number: document?.number ?? entry.documentId,
        title: document?.title ?? "Документ",
        accountingDate: entry.accountingDate,
        amountRub
      });
    }
  }
  return sortPnlDocuments([...rows.values()]);
}

function buildFinanceEventDocumentRefs(financeEvents: any[], documentsById: Map<string, any>, predicate: (event: any) => boolean) {
  const rows = new Map<string, PnlDocumentRef>();
  for (const event of financeEvents.filter(predicate)) {
    const documentId = event.documentId ?? event.id;
    const document = documentsById.get(event.documentId);
    const amountRub = Number(event.amountRub ?? 0);
    if (Math.abs(amountRub) < 0.0001) continue;
    const current = rows.get(documentId);
    if (current) current.amountRub = round2(current.amountRub + amountRub);
    else {
      rows.set(documentId, {
        id: documentId,
        number: document?.number ?? event.number ?? documentId,
        title: document?.title ?? channelFinanceCategoryLabel(event.category),
        accountingDate: String(document?.accountingDate ?? event.occurredAt ?? ""),
        amountRub
      });
    }
  }
  return sortPnlDocuments([...rows.values()]);
}

function buildOperatingExpenseDocumentRefs(operatingExpenses: any[], documentsById: Map<string, any>) {
  return sortPnlDocuments(
    operatingExpenses
      .filter((expense: any) => Number(expense.amountRub ?? 0) !== 0)
      .map((expense: any) => {
        const document = documentsById.get(expense.documentId);
        return {
          id: expense.documentId,
          number: document?.number ?? expense.documentId,
          title: document?.title ?? expense.category ?? "Операционный расход",
          accountingDate: String(document?.accountingDate ?? expense.expenseDate ?? ""),
          amountRub: Number(expense.amountRub ?? 0)
        };
      })
  );
}

function findPnlNode(nodes: PnlTreeNode[], id: string): PnlTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findPnlNode(node.children, id);
    if (child) return child;
  }
  return null;
}

function buildPnlTrendSeries(state: any, from: string, to: string, granularity: "week" | "month") {
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
    const bucketTo = monthEnd > to ? to : monthEnd;
    buckets.push({ from: bucketFrom, to: bucketTo, label: monthLabel(bucketFrom) });
    cursor = startOfMonth(addDays(monthEnd, 1));
  }
  return buckets;
}

function shareHint(amount: number, revenue: number) {
  return `${shareHintValue(amount, revenue)} от выручки`;
}

function shareHintValue(amount: number, revenue: number) {
  if (Math.abs(revenue) < 0.0001) return "0%";
  return plainPercent((amount / revenue) * 100);
}

function plainPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatCompactRub(value: number) {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${round2(value / 1_000_000)} млн`;
  if (absolute >= 1_000) return `${round2(value / 1_000)} тыс`;
  return `${Math.round(value)}`;
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

function toMonthInputValue(value: string) {
  return value.slice(0, 7);
}

function startOfMonthValue(value: string) {
  const [year, month] = value.split("-").map(Number);
  return formatLocalDate(new Date(year, month - 1, 1));
}

function endOfMonthValue(value: string) {
  const [year, month] = value.split("-").map(Number);
  return formatLocalDate(new Date(year, month, 0));
}

function SummaryMetricTile({
  tone,
  label,
  value,
  hint
}: {
  tone: "neutral" | "primary" | "success" | "warning" | "danger" | "info";
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-lg)] border px-4 py-4",
        tone === "success" && "border-[oklch(0.88_0.06_155)] bg-[var(--color-success-soft)]",
        tone === "warning" && "border-[oklch(0.88_0.08_70)] bg-[var(--color-warning-soft)]",
        tone === "danger" && "border-[oklch(0.88_0.06_25)] bg-[var(--color-danger-soft)]",
        tone === "primary" && "border-[oklch(0.88_0.06_258)] bg-[var(--color-primary-soft)]",
        tone === "info" && "border-[oklch(0.88_0.05_230)] bg-[var(--color-info-soft)]",
        tone === "neutral" && "border-[var(--color-border)] bg-[var(--color-card)]"
      )}
    >
      <div className="text-xs font-medium text-[var(--color-muted-foreground)]">{label}</div>
      <div className="mt-2 text-[30px] font-semibold leading-none tracking-tight numeric">{value}</div>
      {hint ? <div className="mt-2 text-xs text-[var(--color-muted-foreground)]">{hint}</div> : null}
    </div>
  );
}

function StagePill({ label, value, note }: { label: ReactNode; value: ReactNode; note: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-muted)]/35 px-4 py-3">
      <div className="text-xs font-medium text-[var(--color-muted-foreground)]">{label}</div>
      <div className="mt-1 text-lg font-semibold numeric">{value}</div>
      <div className="mt-1 text-xs text-[var(--color-muted-foreground)]">{note}</div>
    </div>
  );
}

function PnlTreeRow({
  node,
  depth,
  revenue,
  selectedNodeId,
  expandedNodeIds,
  onToggle,
  onSelect
}: {
  node: PnlTreeNode;
  depth: number;
  revenue: number;
  selectedNodeId: string;
  expandedNodeIds: string[];
  onToggle: (nodeId: string) => void;
  onSelect: (nodeId: string) => void;
}) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expandedNodeIds.includes(node.id);
  const isSelected = node.id === selectedNodeId;

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelect(node.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(node.id);
          }
        }}
        className={cn(
          "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
          isSelected ? "bg-[var(--color-primary-soft)]" : "hover:bg-[var(--color-muted)]/35"
        )}
      >
        <div className="flex min-w-0 flex-1 items-start gap-3" style={{ paddingLeft: depth * 16 }}>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (hasChildren) onToggle(node.id);
            }}
            className={cn(
              "mt-0.5 grid size-5 shrink-0 place-items-center rounded-[var(--radius-sm)] text-[var(--color-muted-foreground)]",
              hasChildren ? "hover:bg-[var(--color-muted)]" : "cursor-default opacity-30"
            )}
            aria-label={hasChildren ? "Развернуть" : "Без вложенных категорий"}
          >
            {hasChildren ? (isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />) : <ChevronRight size={15} />}
          </button>
          <div className="min-w-0">
            <div className={cn("font-medium", depth === 0 && "text-[15px]")}>{node.label}</div>
            {node.note ? <div className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">{node.note}</div> : null}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div
            className={cn(
              "font-semibold numeric",
              node.tone === "success" && node.amountRub >= 0 && "text-[var(--color-success)]",
              node.tone === "danger" && "text-[var(--color-danger)]"
            )}
          >
            {rub(node.amountRub)}
          </div>
          <div className="text-xs text-[var(--color-muted-foreground)]">{shareHintValue(node.amountRub, revenue)}</div>
        </div>
      </div>
      {hasChildren && isExpanded ? (
        <div className="divide-y divide-[var(--color-border)]/80">
          {node.children.map((child) => (
            <PnlTreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              revenue={revenue}
              selectedNodeId={selectedNodeId}
              expandedNodeIds={expandedNodeIds}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PnlTrendTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 shadow-sm">
      <div className="text-xs font-semibold text-[var(--color-muted-foreground)]">{label}</div>
      <div className="mt-2 space-y-1 text-sm">
        {payload.map((item: any) => (
          <div key={item.dataKey} className="flex items-center justify-between gap-4">
            <span className="text-[var(--color-muted-foreground)]">{item.name}</span>
            <span className="font-medium numeric">{rub(Number(item.value ?? 0))}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PnlDetailDialog({
  open,
  onOpenChange,
  node,
  revenue
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node: PnlTreeNode | null;
  revenue: number;
}) {
  if (!node) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{node.label}</DialogTitle>
          <DialogDescription>{node.note ?? "Расшифровка суммы по выбранной статье."}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex max-h-[80vh] flex-col gap-4 overflow-auto">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Info label="Сумма" value={rub(node.amountRub)} />
            <Info label="Доля от выручки" value={shareHintValue(node.amountRub, revenue)} />
            <Info label="Документов" value={String(node.documents.length)} />
          </div>
          {node.children.length > 0 ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">Что внутри</div>
              <div className="space-y-2">
                {node.children.map((child) => (
                  <BreakdownRow key={child.id} label={child.label} value={rub(child.amountRub)} />
                ))}
              </div>
            </div>
          ) : null}
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">Документы</div>
            {node.documents.length === 0 ? (
              <div className="text-sm text-[var(--color-muted-foreground)]">По этой статье нет отдельных документов в выбранном периоде.</div>
            ) : (
              <div className="space-y-2">
                {node.documents.slice(0, 20).map((document) => (
                  <div key={`${node.id}:${document.id}`} className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <Link to={`/documents/${document.id}`} className="font-mono text-sm font-semibold text-[var(--color-primary)] hover:underline">
                        {document.number}
                      </Link>
                      <span className="text-[11px] text-[var(--color-muted-foreground)]">{date(document.accountingDate)}</span>
                    </div>
                    <div className="mt-1 text-sm">{document.title}</div>
                    <div className="mt-1 text-sm font-medium numeric">{rub(document.amountRub)}</div>
                  </div>
                ))}
                {node.documents.length > 20 ? (
                  <div className="text-xs text-[var(--color-muted-foreground)]">И ещё {node.documents.length - 20} документов по этой статье.</div>
                ) : null}
              </div>
            )}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

function BreakdownRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[var(--color-muted-foreground)]">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-3">
      <div className="text-[10px] uppercase tracking-wide font-semibold text-[var(--color-muted-foreground)]">{label}</div>
      <div className="mt-1 break-all text-sm font-medium whitespace-normal">{value}</div>
    </div>
  );
}

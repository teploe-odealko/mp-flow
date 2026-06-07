import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
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
import { apiGet, apiPost } from "@/api";
import { rub, date } from "@/lib/format";
import { cn } from "@/lib/cn";
import { paginateRows } from "@/lib/pagination";
import { ProductCell } from "@/components/product-thumb";
import {
  channelFinanceCategoryLabel
} from "../../../shared/channel-finance";

export function ReportsWorkspace() {
  const { pathname } = useLocation();
  const [dateFrom, setDateFrom] = useState(firstDayOfMonth(new Date()));
  const [dateTo, setDateTo] = useState(lastDayOfMonth(new Date()));
  const [balanceDate, setBalanceDate] = useState(lastDayOfMonth(new Date()));
  const [compareBalance, setCompareBalance] = useState(false);
  const [compareBalanceDate, setCompareBalanceDate] = useState(endOfPreviousMonth(new Date()));
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
  const reportsQuery = useQuery({
    queryKey: ["reports-workspace", dateFrom, dateTo, balanceDate, compareBalance ? compareBalanceDate : "", pnlGranularity],
    queryFn: () =>
      apiGet<any>(
        reportWorkspacePath({
          dateFrom,
          dateTo,
          balanceDate,
          compareBalanceDate: compareBalance ? compareBalanceDate : undefined,
          pnlGranularity
        })
      )
  });

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

  const reports = reportsQuery.data ?? emptyReportsWorkspacePayload({ balanceDate, compareBalanceDate: compareBalance ? compareBalanceDate : undefined });
  const current = reports.current;
  const balanceCurrent = reports.balanceCurrent;
  const balanceCompare = compareBalance ? reports.balanceCompare : undefined;
  const pnlTree = reports.pnlTree ?? [];
  const selectedPnlNode = useMemo(
    () => findPnlNode(pnlTree, selectedPnlNodeId) ?? pnlTree.find((node) => node.id === "net-profit") ?? pnlTree[0] ?? null,
    [pnlTree, selectedPnlNodeId]
  );
  const pnlTrend = reports.pnlTrend ?? [];
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
  const unitBaseRows = reports.unitRows ?? [];
  const unitRows = useMemo(() => {
    return unitBaseRows.filter((row) => {
      if (productId && row.product?.id !== productId) return false;
      if (channelId && row.channel?.id !== channelId) return false;
      if (profitability === "profit" && row.profitRub <= 0) return false;
      if (profitability === "loss" && row.profitRub >= 0) return false;
      if (linkedExpenseStatus === "with_expenses" && row.isProvisional) return false;
      if (linkedExpenseStatus === "without_expenses" && !row.isProvisional) return false;
      return true;
    });
  }, [channelId, linkedExpenseStatus, unitBaseRows, productId, profitability]);
  const unitFinanceLag = reports.unitFinanceLag ?? emptyFinanceLag();
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
                {(reports.channelOptions ?? []).map((channel: any) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
              </Select>
              <Select value={productId} onChange={(event) => setProductId(event.target.value)} className="w-44">
                <option value="">Все товары</option>
                {(reports.productOptions ?? []).map((product: any) => <option key={product.id} value={product.id}>{product.sku}</option>)}
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

    </div>
  );
}

function reportWorkspacePath(options: {
  dateFrom: string;
  dateTo: string;
  balanceDate: string;
  compareBalanceDate?: string;
  pnlGranularity: "week" | "month";
}) {
  const params = new URLSearchParams({
    dateFrom: options.dateFrom,
    dateTo: options.dateTo,
    balanceDate: options.balanceDate,
    pnlGranularity: options.pnlGranularity
  });
  if (options.compareBalanceDate) params.set("compareBalanceDate", options.compareBalanceDate);
  return `/api/reports/workspace?${params.toString()}`;
}

function emptyReportsWorkspacePayload(options: { balanceDate: string; compareBalanceDate?: string }) {
  const current = {
    pnl: {
      revenue: 0,
      costOfSales: 0,
      grossProfit: 0,
      afterCostOfSales: 0,
      variableMarketplaceExpenses: 0,
      commissionExpense: 0,
      acquiringExpense: 0,
      lastMileExpense: 0,
      returnLogisticsExpense: 0,
      otherVariableMarketplaceExpense: 0,
      contributionProfit: 0,
      afterMarketplaceExpenses: 0,
      adsExpense: 0,
      storageExpense: 0,
      crossDockingExpense: 0,
      inboundHandlingExpense: 0,
      subscriptionExpense: 0,
      storageHandlingExpense: 0,
      otherChannelExpense: 0,
      channelOperatingExpenses: 0,
      operatingExpenses: 0,
      otherIncome: 0,
      otherExpense: 0,
      totalExpenses: 0,
      netProfit: 0,
      netMarginPercent: 0
    },
    sales: [],
    financeLag: emptyFinanceLag(),
    unitRows: []
  };
  return {
    current,
    balanceCurrent: emptyBalanceSnapshot(options.balanceDate),
    balanceCompare: options.compareBalanceDate ? emptyBalanceSnapshot(options.compareBalanceDate) : undefined,
    pnlTree: [],
    pnlTrend: [],
    unitRows: [],
    unitFinanceLag: emptyFinanceLag(),
    productOptions: [],
    channelOptions: []
  };
}

function emptyBalanceSnapshot(asOf: string) {
  return {
    asOf,
    cash: 0,
    inventory: 0,
    marketplaceAwaitingAccrual: 0,
    supplierAdvances: 0,
    supplierClaims: 0,
    marketplaceReceivable: 0,
    supplierPayables: 0,
    unpaidExpenses: 0,
    channelObligations: 0,
    ownerContributions: 0,
    ownerWithdrawals: 0,
    retainedEarnings: 0,
    assets: 0,
    liabilities: 0,
    equity: 0,
    difference: 0
  };
}

function emptyFinanceLag() {
  return {
    unsettledSalesCount: 0,
    unsettledSalesRevenueRub: 0,
    unsettledQty: 0,
    settledThroughByChannel: {}
  };
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

function BalanceTable({
  currentDate,
  compareDate,
  rows
}: {
  currentDate: string;
  compareDate?: string;
  rows: BalanceTableRow[];
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
          return (
            <TR key={row.key} className={row.emphasis ? "bg-[var(--color-muted)]/30" : undefined}>
              <TD className={row.emphasis ? "font-semibold" : undefined}>{row.label}</TD>
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

function findPnlNode(nodes: PnlTreeNode[], id: string): PnlTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findPnlNode(node.children, id);
    if (child) return child;
  }
  return null;
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

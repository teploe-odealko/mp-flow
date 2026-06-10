import { describe, expect, it } from "vitest";
import { AccountingApp } from "../../src/core/accounting-app";
import { resetIds } from "../../src/core/utils";
import { buildReportsWorkspacePayload, type ReportsWorkspaceInput } from "../../src/shared/reports-workspace";

const JUNE_OPTIONS = {
  dateFrom: "2026-06-01",
  dateTo: "2026-06-30",
  balanceDate: "2026-06-30",
  pnlGranularity: "month" as const
};

function workspaceInput(app: AccountingApp): ReportsWorkspaceInput {
  return {
    channelFinanceEvents: app.state.channelFinanceEvents,
    chartAccounts: app.state.chartAccounts,
    documents: app.state.documents,
    journalEntries: app.state.journalEntries,
    journalLines: app.state.journalLines,
    operatingExpenses: app.state.operatingExpenses,
    ownerTransactions: app.state.ownerTransactions,
    products: app.state.products,
    saleLines: app.state.saleLines,
    sales: app.state.sales,
    salesChannels: app.state.salesChannels
  };
}

async function appWithOperatingExpense(accountCode: "26" | "44" | "91.02") {
  resetIds();
  const app = new AccountingApp();
  await app.bootstrap({ displayName: "Тест", accountingStartDate: "2026-06-01" });
  const category = app.state.expenseCategories.find((candidate) => candidate.accountCode === accountCode);
  expect(category).toBeDefined();
  await app.recordOperatingExpense({ categoryId: category!.id, expenseDate: "2026-06-05", amountRub: 100 });
  return app;
}

describe("reports workspace P&L", () => {
  it("counts an operating expense with account 91.02 exactly once", async () => {
    const app = await appWithOperatingExpense("91.02");
    const payload = buildReportsWorkspacePayload(workspaceInput(app), JUNE_OPTIONS);

    expect(payload.current.pnl.operatingExpenses).toBe(100);
    expect(payload.current.pnl.otherExpense).toBe(0);
    expect(payload.current.pnl.totalExpenses).toBe(100);
    expect(payload.current.pnl.netProfit).toBe(-100);

    const expensesBranch = payload.pnlTree.find((node: any) => node.id === "expenses");
    expect(expensesBranch).toBeDefined();
    expect(expensesBranch!.amountRub).toBe(100);
    const childIds = expensesBranch!.children.map((child: any) => child.id);
    expect(childIds).toContain("operating-expenses");
    expect(childIds).not.toContain("other-expenses");

    const trendNetProfit = payload.pnlTrend.reduce((sum: number, bucket: any) => sum + bucket.netProfit, 0);
    expect(trendNetProfit).toBeCloseTo(-100, 2);
  });

  it("keeps an operating expense with account 26 counted once", async () => {
    const app = await appWithOperatingExpense("26");
    const payload = buildReportsWorkspacePayload(workspaceInput(app), JUNE_OPTIONS);

    expect(payload.current.pnl.operatingExpenses).toBe(100);
    expect(payload.current.pnl.otherExpense).toBe(0);
    expect(payload.current.pnl.totalExpenses).toBe(100);
    expect(payload.current.pnl.netProfit).toBe(-100);
  });

  it("keeps genuine other expenses on 91.02 in the report", async () => {
    const app = await appWithOperatingExpense("91.02");
    const input = workspaceInput(app);
    const organizationId = app.state.journalEntries[0]?.organizationId ?? "org_test";
    const inputWithManualWriteOff: ReportsWorkspaceInput = {
      ...input,
      journalEntries: [
        ...input.journalEntries,
        {
          id: "je_manual_other_expense",
          organizationId,
          documentId: "doc_manual_other_expense",
          accountingDate: "2026-06-10",
          memo: "Списание недопоставки",
          createdAt: "2026-06-10T00:00:00.000Z"
        }
      ],
      journalLines: [
        ...input.journalLines,
        { id: "jl_manual_91_02", journalEntryId: "je_manual_other_expense", accountCode: "91.02", debit: 50, credit: 0 },
        { id: "jl_manual_60_02", journalEntryId: "je_manual_other_expense", accountCode: "60.02", debit: 0, credit: 50 }
      ]
    };
    const payload = buildReportsWorkspacePayload(inputWithManualWriteOff, JUNE_OPTIONS);

    expect(payload.current.pnl.operatingExpenses).toBe(100);
    expect(payload.current.pnl.otherExpense).toBe(50);
    expect(payload.current.pnl.totalExpenses).toBe(150);
    expect(payload.current.pnl.netProfit).toBe(-150);
  });

  it("keeps the P&L identities consistent on demo data", async () => {
    resetIds();
    const app = new AccountingApp();
    await app.setupDemo();
    const payload = buildReportsWorkspacePayload(workspaceInput(app), JUNE_OPTIONS);
    const pnl = payload.current.pnl;

    expect(pnl.totalExpenses).toBeCloseTo(
      pnl.costOfSales + pnl.variableMarketplaceExpenses + pnl.channelOperatingExpenses + pnl.operatingExpenses + pnl.otherExpense,
      2
    );
    expect(pnl.netProfit).toBeCloseTo(
      pnl.revenue - pnl.costOfSales - pnl.variableMarketplaceExpenses - pnl.channelOperatingExpenses - pnl.operatingExpenses + pnl.otherIncome - pnl.otherExpense,
      2
    );
  });
});

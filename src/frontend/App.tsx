import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { LoginPage, RequireAuth, SignupPage, VerifyEmailPage } from "@/pages/auth/AuthPages";
import { AppShell } from "@/layout/AppShell";
import { HomePage } from "@/pages/home/HomePage";
import { SetupPage } from "@/pages/setup/SetupPage";
import { SettingsOverviewPage } from "@/pages/setup/SettingsOverviewPage";
import { McpSettingsPage } from "@/pages/setup/McpSettingsPage";
import { AccountingWorkspace } from "@/pages/accounting/AccountingWorkspace";
import { ChartAccountsPage } from "@/pages/accounting/ChartAccountsPage";
import { JournalEntryPage, JournalPage } from "@/pages/accounting/JournalPage";
import { LedgerPage } from "@/pages/accounting/LedgerPage";
import { DocumentsPage } from "@/pages/documents/DocumentsPage";
import { DocumentCardPage } from "@/pages/documents/DocumentCardPage";
import { ProductsPage } from "@/pages/products/ProductsPage";
import { ProductFormPage } from "@/pages/products/ProductFormPage";
import { ProductCardPage, ProductLotsPage } from "@/pages/products/ProductCardPage";
import { ChannelMappingPage } from "@/pages/products/ChannelMappingPage";
import { InventoryWorkspace } from "@/pages/inventory/InventoryWorkspace";
import {
  OpeningBalanceFormPage,
  StockMovementsPage,
  TransferFormPage,
  TransferCardPage,
  SalesPointStockPage,
  InventoryReconciliationPage,
  StockAdjustmentPage
} from "@/pages/inventory/forms";
import { ProcurementWorkspace } from "@/pages/procurement/ProcurementWorkspace";
import { PurchaseOrderCardPage } from "@/pages/procurement/PurchaseOrderCardPage";
import {
  PurchaseOrderFormPage,
  SupplierPaymentFormPage,
  GoodsReceiptFormPage,
  ProcurementCostFormPage,
  ShortageResolutionFormPage
} from "@/pages/procurement/forms";
import { ReceiptDispatchPage } from "@/pages/procurement/ReceiptDispatchPage";
import { SalesWorkspace, SaleCardPage, ReturnsListPage, ReturnFormPage, ReturnCardPage, ManualSaleFormPage } from "@/pages/sales/SalesPages";
import {
  ChannelsWorkspace,
  ChannelFormPage,
  ChannelSyncPage,
  SyncInboxPage,
  ChannelFinancePage,
  FinanceEventCardPage
} from "@/pages/channels/ChannelsPages";
import { ChannelDetailPage } from "@/pages/channels/ChannelDetailPage";
import { MoneyWorkspace, OwnerContributionFormPage, OwnerWithdrawalFormPage, PayoutFormPage, PayoutsPage, PayoutReconciliationPage } from "@/pages/money/MoneyPages";
import { ExpenseFormPage, ExpenseCardPage } from "@/pages/expenses/ExpensesPages";
import { ReportsWorkspace } from "@/pages/reports/ReportsPage";
import { ControlsWorkspace } from "@/pages/controls/ControlsPages";
import { AuditPage } from "@/pages/access/AccessPages";
import { BackfillWizardPage } from "@/pages/onboarding/OnboardingPages";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/api";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />

      <Route element={<RequireAuth><AppShell /></RequireAuth>}>
        <Route path="/" element={<HomePage />} />

        <Route path="/setup" element={<SetupPage />} />
        <Route path="/setup/review" element={<LegacySetupReviewRedirect />} />
        <Route path="/setup/existing-store" element={<BackfillWizardPage />} />
        <Route path="/setup/existing-store/:projectId/review" element={<LegacyBackfillReviewRedirect />} />
        <Route path="/setup/existing-store/import/review" element={<Navigate to="/setup/existing-store?from=setup&mode=historical_backfill" replace />} />
        <Route path="/settings" element={<SettingsOverviewPage />} />
        <Route path="/settings/mcp" element={<McpSettingsPage />} />
        <Route path="/settings/periods" element={<Navigate to="/settings" replace />} />

        <Route path="/accounting" element={<AccountingWorkspace />} />
        <Route path="/settings/chart-accounts" element={<ChartAccountsPage />} />
        <Route path="/reports/journal" element={<JournalPage />} />
        <Route path="/reports/journal/:entryId" element={<JournalEntryPage />} />
        <Route path="/reports/ledger" element={<LedgerPage />} />

        <Route path="/documents" element={<DocumentsPage />} />
        <Route path="/documents/:id" element={<DocumentCardPage />} />

        <Route path="/products" element={<ProductsPage />} />
        <Route path="/products/new" element={<ProductFormPage />} />
        <Route path="/products/channel-mapping" element={<ChannelMappingPage />} />
        <Route path="/products/:id" element={<ProductCardPage />} />
        <Route path="/products/:id/edit" element={<ProductFormPage />} />
        <Route path="/products/:id/lots" element={<ProductLotsPage />} />

        <Route path="/inventory" element={<InventoryWorkspace />} />
        <Route path="/inventory/opening-balances/new" element={<OpeningBalanceFormPage />} />
        <Route path="/inventory/movements" element={<StockMovementsPage />} />
        <Route path="/inventory/transfers/new" element={<TransferFormPage />} />
        <Route path="/inventory/transfers/:id" element={<TransferCardPage />} />
        <Route path="/inventory/sales-points/:id" element={<SalesPointStockPage />} />
        <Route path="/inventory/reconciliation" element={<InventoryReconciliationPage />} />
        <Route path="/inventory/reconciliation/:id/resolve" element={<StockAdjustmentPage />} />

        <Route path="/procurement" element={<ProcurementWorkspace />} />
        <Route path="/procurement/purchase-orders" element={<ProcurementWorkspace />} />
        <Route path="/procurement/purchase-orders/new" element={<PurchaseOrderFormPage />} />
        <Route path="/procurement/purchase-orders/:id" element={<PurchaseOrderCardPage />} />
        <Route path="/procurement/purchase-orders/:id/edit" element={<PurchaseOrderFormPage />} />
        <Route path="/procurement/purchase-orders/:id/payments/new" element={<SupplierPaymentFormPage />} />
        <Route path="/procurement/purchase-orders/:id/receipts/new" element={<GoodsReceiptFormPage />} />
        <Route path="/procurement/receipts/:receiptId/dispatch" element={<ReceiptDispatchPage />} />
        <Route path="/procurement/costs/new" element={<ProcurementCostFormPage />} />
        <Route path="/procurement/purchase-orders/:id/costs/new" element={<ProcurementCostFormPage />} />
        <Route path="/procurement/purchase-orders/:id/shortages/new" element={<ShortageResolutionFormPage />} />

        <Route path="/sales" element={<SalesWorkspace />} />
        <Route path="/sales/new" element={<ManualSaleFormPage />} />
        <Route path="/sales/:id" element={<SaleCardPage />} />
        <Route path="/sales/:id/returns/new" element={<ReturnFormPage />} />
        <Route path="/sales/:saleId/returns/new" element={<ReturnFormPage />} />
        <Route path="/returns" element={<ReturnsListPage />} />
        <Route path="/returns/:id" element={<ReturnCardPage />} />

        <Route path="/channels" element={<ChannelsWorkspace />} />
        <Route path="/integrations/channels" element={<ChannelsWorkspace />} />
        <Route path="/integrations/channels/new" element={<ChannelFormPage />} />
        <Route path="/integrations/channels/:id" element={<ChannelDetailPage />} />
        <Route path="/integrations/channels/:id/onboarding" element={<BackfillWizardPage />} />
        <Route path="/integrations/channels/:id/sync" element={<ChannelSyncPage />} />
        <Route path="/integrations/inbox" element={<SyncInboxPage />} />
        <Route path="/integrations/channels/:id/finance" element={<ChannelFinancePage />} />
        <Route path="/integrations/finance-events/:id" element={<FinanceEventCardPage />} />

        <Route path="/money" element={<MoneyWorkspace />} />
        <Route path="/money/owner-contributions/new" element={<OwnerContributionFormPage />} />
        <Route path="/money/owner-withdrawals/new" element={<OwnerWithdrawalFormPage />} />
        <Route path="/money/procurement-costs/new" element={<ProcurementCostFormPage />} />
        <Route path="/money/supplier-payments/new" element={<SupplierPaymentFormPage />} />
        <Route path="/finance/payouts/new" element={<PayoutFormPage />} />
        <Route path="/finance/payouts" element={<PayoutsPage />} />
        <Route path="/finance/payouts/:id/reconciliation" element={<PayoutReconciliationPage />} />

        <Route path="/expenses" element={<Navigate to="/money?view=outgoing&type=expense_like" replace />} />
        <Route path="/finance/expenses" element={<Navigate to="/money?view=outgoing&type=expense_like" replace />} />
        <Route path="/finance/expenses/new" element={<ExpenseFormPage />} />
        <Route path="/finance/expenses/:id" element={<ExpenseCardPage />} />

        <Route path="/reports" element={<ReportsWorkspace />} />
        <Route path="/reports/profit-and-loss" element={<ReportsWorkspace />} />
        <Route path="/reports/balance-sheet" element={<ReportsWorkspace />} />
        <Route path="/reports/unit-economics" element={<ReportsWorkspace />} />

        <Route path="/controls" element={<ControlsWorkspace />} />
        <Route path="/controls/corrections" element={<ControlsWorkspace />} />
        <Route path="/controls/audit" element={<AuditPage />} />

        <Route path="/access" element={<Navigate to="/" replace />} />
        <Route path="/settings/users" element={<Navigate to="/" replace />} />

        <Route path="/onboarding/existing-store" element={<ExistingStoreEntryRedirect />} />
        <Route path="/onboarding/existing-store/import/review" element={<Navigate to="/setup/existing-store/import/review" replace />} />
        <Route path="/onboarding/existing-store/:projectId/review" element={<LegacyBackfillReviewRedirect />} />
      </Route>
    </Routes>
  );
}

function ExistingStoreEntryRedirect() {
  const dashboardQuery = useQuery({ queryKey: ["dashboard"], queryFn: () => apiGet<any>("/api/dashboard") });
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const mode = searchParams.get("mode") === "current_stock_start" ? "current_stock_start" : "historical_backfill";
  const start = searchParams.get("start");
  const confirmed = searchParams.get("confirmed") === "1";
  const suffix = [
    "from=setup",
    `mode=${mode}`,
    mode === "historical_backfill" && start ? `start=${encodeURIComponent(start)}` : "",
    confirmed ? "confirmed=1" : ""
  ].filter(Boolean).join("&");

  if (dashboardQuery.isLoading) return null;
  return <Navigate to={dashboardQuery.data?.configured ? `/setup/existing-store?${suffix}` : "/setup"} replace />;
}

function LegacySetupReviewRedirect() {
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  searchParams.delete("step");
  if (searchParams.get("mode") !== "from_scratch") {
    searchParams.set("mode", "existing_store");
    if (!searchParams.get("estoreMode")) searchParams.set("estoreMode", "historical_backfill");
  }
  const suffix = searchParams.toString();
  return <Navigate to={suffix ? `/setup?${suffix}` : "/setup"} replace />;
}

function LegacyBackfillReviewRedirect() {
  const { projectId } = useParams();
  return <Navigate to={projectId ? `/setup/existing-store?from=setup&projectId=${encodeURIComponent(projectId)}` : "/setup/existing-store?from=setup&mode=historical_backfill"} replace />;
}

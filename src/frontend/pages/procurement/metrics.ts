import type { AppState } from "@/layout/AppShell";

const closedShortageActions = new Set([
  "supplier_claim",
  "loss",
  "close_without_accounting"
]);

export interface PurchaseOrderMetrics {
  totalOrderedQty: number;
  totalPaidRub: number;
  totalReceivedGoodsRub: number;
  totalProcurementCostsRub: number;
  totalCapitalizedRub: number;
  receivedQty: number;
  closedShortageQty: number;
  completedQty: number;
  remainingQty: number;
  inventoryGapRub: number;
  receiptQtyByReceiptId: Map<string, number>;
}

export function getPurchaseOrderMetrics(state: AppState, purchaseOrderId: string): PurchaseOrderMetrics {
  const documents = state.documents ?? [];
  const postedDocumentIds = new Set(
    documents.filter((document: any) => document.status === "posted").map((document: any) => document.id)
  );
  const lines = (state.purchaseOrderLines ?? []).filter((line: any) => line.purchaseOrderId === purchaseOrderId);
  const lineIds = new Set(lines.map((line: any) => line.id));

  const receipts = (state.goodsReceipts ?? []).filter((receipt: any) => receipt.purchaseOrderId === purchaseOrderId && postedDocumentIds.has(receipt.documentId));
  const receiptIds = new Set(receipts.map((receipt: any) => receipt.id));
  const receiptLines = (state.goodsReceiptLines ?? []).filter((line: any) => receiptIds.has(line.goodsReceiptId));

  const shortages = (state.shortageResolutions ?? []).filter((resolution: any) => resolution.purchaseOrderId === purchaseOrderId && postedDocumentIds.has(resolution.documentId));
  const shortageIds = new Set(shortages.map((resolution: any) => resolution.id));
  const shortageLines = (state.shortageResolutionLines ?? []).filter((line: any) => shortageIds.has(line.shortageResolutionId));

  const procurementCosts = (state.procurementCosts ?? []).filter((cost: any) => cost.purchaseOrderId === purchaseOrderId && postedDocumentIds.has(cost.documentId));
  const allocations = (state.paymentAllocations ?? []).filter((allocation: any) => allocation.purchaseOrderId === purchaseOrderId);
  const allocationPaymentIds = new Set(allocations.map((allocation: any) => allocation.paymentId));
  const payments = (state.payments ?? []).filter((payment: any) => allocationPaymentIds.has(payment.id) && postedDocumentIds.has(payment.documentId));

  const totalOrderedQty = round4(lines.reduce((sum: number, line: any) => sum + Number(line.qtyOrdered ?? 0), 0));
  const totalPaidRub = round2(payments.reduce((sum: number, payment: any) => sum + Number(payment.amountRub ?? 0), 0));
  const totalReceivedGoodsRub = round2(receipts.reduce((sum: number, receipt: any) => sum + Number(receipt.goodsCostRubTotal ?? 0), 0));
  const totalProcurementCostsRub = round2(procurementCosts.reduce((sum: number, cost: any) => sum + Number(cost.amountRub ?? 0), 0));
  const totalCapitalizedRub = round2(totalReceivedGoodsRub + totalProcurementCostsRub);
  const receivedQty = round4(
    receiptLines
      .filter((line: any) => lineIds.has(line.purchaseOrderLineId))
      .reduce((sum: number, line: any) => sum + Number(line.qtyReceived ?? 0), 0)
  );
  const closedShortageQty = round4(
    shortageLines
      .filter((line: any) => closedShortageActions.has(line.action))
      .reduce((sum: number, line: any) => sum + Number(line.qtyShortage ?? 0), 0)
  );
  const completedQty = round4(Math.min(totalOrderedQty, receivedQty + closedShortageQty));
  const remainingQty = round4(Math.max(0, totalOrderedQty - completedQty));
  const inventoryGapRub = round2(totalPaidRub - totalCapitalizedRub);
  const receiptQtyByReceiptId = new Map<string, number>();

  for (const receiptLine of receiptLines) {
    const current = receiptQtyByReceiptId.get(receiptLine.goodsReceiptId) ?? 0;
    receiptQtyByReceiptId.set(receiptLine.goodsReceiptId, round4(current + Number(receiptLine.qtyReceived ?? 0)));
  }

  return {
    totalOrderedQty,
    totalPaidRub,
    totalReceivedGoodsRub,
    totalProcurementCostsRub,
    totalCapitalizedRub,
    receivedQty,
    closedShortageQty,
    completedQty,
    remainingQty,
    inventoryGapRub,
    receiptQtyByReceiptId
  };
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function round4(value: number) {
  return Math.round(value * 10000) / 10000;
}

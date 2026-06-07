import type { ReceiptPreview, ReceiptPreviewLine } from "../../core/accounting-app";
import type { ID, PurchaseOrderLine } from "../../core/models";
import { DomainError, round2, round4, round6 } from "../../core/utils";
import type { RuntimeReadContext } from "../../infra/db/runtime-store";

export async function defaultReceiptPreviewFor(readContext: RuntimeReadContext, purchaseOrderId: ID): Promise<ReceiptPreview> {
  const [purchaseOrders, purchaseOrderLines, documents, receipts, receiptLines] = await Promise.all([
    readContext.repos.purchaseOrders.all(),
    readContext.repos.purchaseOrderLines.all(),
    readContext.repos.documents.all(),
    readContext.repos.goodsReceipts.all(),
    readContext.repos.goodsReceiptLines.all()
  ]);
  const order = mustFind(purchaseOrders, purchaseOrderId, "purchase_order_not_found");
  const lines = purchaseOrderLines
    .filter((line) => line.purchaseOrderId === order.id)
    .map((line) => ({
      purchaseOrderLineId: line.id,
      qtyReceived: line.qtyOrdered - receiptLines
        .filter((receiptLine) =>
          receiptLine.purchaseOrderLineId === line.id &&
          receipts.some((receipt) =>
            receipt.id === receiptLine.goodsReceiptId &&
            receipt.status === "posted" &&
            documents.find((document) => document.id === receipt.documentId)?.status === "posted"
          )
        )
        .reduce((sum, receiptLine) => sum + receiptLine.qtyReceived, 0)
    }))
    .filter((line) => line.qtyReceived > 0);
  return await receiptPreviewFor(readContext, { purchaseOrderId: order.id, lines });
}

export async function receiptPreviewFor(readContext: RuntimeReadContext, input: {
  purchaseOrderId: ID;
  lines: Array<{ purchaseOrderLineId: ID; qtyReceived: number }>;
}): Promise<ReceiptPreview> {
  const [
    purchaseOrders,
    purchaseOrderLines,
    payments,
    documents,
    paymentAllocations,
    receipts
  ] = await Promise.all([
    readContext.repos.purchaseOrders.all(),
    readContext.repos.purchaseOrderLines.all(),
    readContext.repos.payments.all(),
    readContext.repos.documents.all(),
    readContext.repos.paymentAllocations.all(),
    readContext.repos.goodsReceipts.all()
  ]);
  const order = mustFind(purchaseOrders, input.purchaseOrderId, "purchase_order_not_found");
  const orderLines = purchaseOrderLines.filter((line) => line.purchaseOrderId === order.id);
  const totalOrderBasis = round2(orderLines.reduce((sum, line) => sum + line.supplierAmount, 0));
  const linkedGoodsPaymentRub = round2(
    paymentAllocations
      .filter((allocation) =>
        allocation.purchaseOrderId === order.id &&
        allocation.allocationPurpose === "goods_purchase" &&
        documents.find((document) => document.id === payments.find((payment) => payment.id === allocation.paymentId)?.documentId)?.status === "posted"
      )
      .reduce((sum, allocation) => sum + allocation.amountRub, 0)
  );
  const previousReceiptCostRub = round2(
    receipts
      .filter((receipt) =>
        receipt.purchaseOrderId === order.id &&
        receipt.status === "posted" &&
        documents.find((document) => document.id === receipt.documentId)?.status === "posted"
      )
      .reduce((sum, receipt) => sum + receipt.goodsCostRubTotal, 0)
  );
  const currentReceiptSupplierBasis = round2(
    input.lines.reduce((sum, receiptLine) => {
      const orderLine = mustFind(orderLines, receiptLine.purchaseOrderLineId, "purchase_order_line_not_found");
      return sum + receiptLine.qtyReceived * orderLine.supplierUnitPrice;
    }, 0)
  );
  const suggestedGoodsCostRub =
    totalOrderBasis > 0
      ? round2((linkedGoodsPaymentRub * currentReceiptSupplierBasis) / totalOrderBasis)
      : round2(linkedGoodsPaymentRub - previousReceiptCostRub);
  const boundedSuggestion = Math.max(0, round2(Math.min(suggestedGoodsCostRub, linkedGoodsPaymentRub - previousReceiptCostRub)));
  return {
    linkedGoodsPaymentRub,
    previousReceiptCostRub,
    suggestedGoodsCostRub: boundedSuggestion,
    remainingAdvanceRub: round2(linkedGoodsPaymentRub - previousReceiptCostRub - boundedSuggestion),
    lines: allocateReceiptLines(input.lines, orderLines, boundedSuggestion)
  };
}

const mustFind = <T extends { id: ID }>(items: T[], idValue: ID, code: string): T => {
  const item = items.find((candidate) => candidate.id === idValue);
  if (!item) throw new DomainError(code, `Не найдена запись ${idValue}`);
  return item;
};

function allocateReceiptLines(
  receiptLines: Array<{ purchaseOrderLineId: ID; qtyReceived: number }>,
  orderLines: PurchaseOrderLine[],
  goodsCostRubTotal: number
): ReceiptPreviewLine[] {
  const bases = receiptLines.map((line) => {
    const orderLine = orderLines.find((candidate) => candidate.id === line.purchaseOrderLineId);
    if (!orderLine) throw new DomainError("purchase_order_line_not_found", "Строка заказа не найдена");
    return {
      receiptLine: line,
      orderLine,
      basis: round2(line.qtyReceived * orderLine.supplierUnitPrice)
    };
  });
  const totalBasis = round2(bases.reduce((sum, item) => sum + item.basis, 0));
  const totalQty = round4(bases.reduce((sum, item) => sum + item.receiptLine.qtyReceived, 0));
  let allocated = 0;
  return bases.map((item, index) => {
    const isLast = index === bases.length - 1;
    const share = totalBasis > 0 ? item.basis / totalBasis : item.receiptLine.qtyReceived / totalQty;
    const allocatedGoodsCostRub = isLast ? round2(goodsCostRubTotal - allocated) : round2(goodsCostRubTotal * share);
    allocated = round2(allocated + allocatedGoodsCostRub);
    return {
      purchaseOrderLineId: item.orderLine.id,
      productId: item.orderLine.productId,
      qtyReceived: round4(item.receiptLine.qtyReceived),
      supplierAmountBasis: item.basis,
      allocatedGoodsCostRub,
      unitCostRub: item.receiptLine.qtyReceived > 0 ? round6(allocatedGoodsCostRub / item.receiptLine.qtyReceived) : 0
    };
  });
}

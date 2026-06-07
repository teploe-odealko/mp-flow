import type {
  DocumentDescendantSummary,
  EntityRollbackBlockerSummary,
  EntityRollbackEffectsSummary,
  EntityRollbackPreview,
  RollbackRelatedDocumentSummary
} from "../../core/accounting-app";
import type { ChannelFinanceEvent, DocumentLink, ID, ProcurementCost, PurchaseOrderLine, Sale } from "../../core/models";
import { DomainError, round2, round4 } from "../../core/utils";
import type { RuntimeReadContext } from "../../infra/db/runtime-store";

const emptyRollbackEffects = (): EntityRollbackEffectsSummary => ({
  documents: 0,
  journalEntries: 0,
  journalLines: 0,
  settlementEntries: 0,
  stockMovements: 0,
  inventoryLots: 0,
  costApplications: 0,
  saleLines: 0,
  financeEvents: 0,
  stockTransfers: 0,
  payments: 0,
  paymentAllocations: 0,
  externalEventsToReset: 0
});

const mustFind = <T extends { id: ID }>(items: T[], idValue: ID, code: string): T => {
  const item = items.find((candidate) => candidate.id === idValue);
  if (!item) throw new DomainError(code, `Не найдена запись ${idValue}`);
  return item;
};

export async function goodsReceiptRollbackPreviewFor(readContext: RuntimeReadContext, receiptId: ID): Promise<EntityRollbackPreview> {
  const [
    receipts,
    documents,
    inventoryLots,
    procurementCosts,
    procurementCostLines,
    journalEntries,
    journalLines,
    settlementEntries,
    stockMovements
  ] = await Promise.all([
    readContext.repos.goodsReceipts.all(),
    readContext.repos.documents.all(),
    readContext.repos.inventoryLots.all(),
    readContext.repos.procurementCosts.all(),
    readContext.repos.procurementCostLines.all(),
    readContext.repos.journalEntries.all(),
    readContext.repos.journalLines.all(),
    readContext.repos.settlementEntries.all(),
    readContext.repos.stockMovements.all()
  ]);
  const receipt = mustFind(receipts, receiptId, "receipt_not_found");
  const document = mustFind(documents, receipt.documentId, "document_not_found");
  const lots = inventoryLots.filter((lot) => lot.sourceDocumentId === document.id);
  const lotIds = new Set(lots.map((lot) => lot.id));
  const descendants = await documentDescendants(readContext, document.id);
  const downstream = await inventoryUsageDocuments(readContext, document.id);
  const blockers: EntityRollbackBlockerSummary[] = [];

  if (downstream.length > 0) {
    blockers.push({
      code: "goods_receipt_has_downstream_usage",
      message: "Нельзя удалить приёмку: товар из неё уже перемещён, продан или списан",
      relatedDocuments: downstream
    });
  }

  const costDocuments = Array.from(new Set(
    procurementCostLines
      .filter((line) => line.lotId && lotIds.has(line.lotId))
      .map((line) => procurementCosts.find((cost) => cost.id === line.procurementCostId))
      .filter((cost): cost is ProcurementCost => Boolean(cost && cost.status !== "cancelled"))
      .map((cost) => cost.documentId)
  ));
  if (costDocuments.length > 0) {
    blockers.push({
      code: "goods_receipt_has_procurement_costs",
      message: "Сначала удалите расходы закупки, отнесённые на партии этой приёмки",
      relatedDocuments: (await Promise.all(
        costDocuments.map((documentId) => findRollbackDocumentSummary(readContext, documentId))
      )).filter((item): item is RollbackRelatedDocumentSummary => Boolean(item))
    });
  }

  if (descendants.length > 0) {
    blockers.push({
      code: "document_has_descendants",
      message: "Сначала удалите зависимые документы этой приёмки",
      relatedDocuments: rollbackRelatedFromDescendants(descendants)
    });
  }

  const journalEntryIds = new Set(journalEntries.filter((entry) => entry.documentId === document.id).map((entry) => entry.id));
  return {
    entityType: "goods_receipt",
    entityId: receipt.id,
    documentId: document.id,
    documentNumber: document.number,
    title: document.title,
    status: receipt.status,
    accountingDate: document.accountingDate,
    canDelete: blockers.length === 0,
    blockers,
    descendants,
    effects: {
      ...emptyRollbackEffects(),
      documents: 1,
      inventoryLots: lots.length,
      stockMovements: stockMovements.filter((movement) => movement.documentId === document.id).length,
      journalEntries: journalEntryIds.size,
      journalLines: journalLines.filter((line) => journalEntryIds.has(line.journalEntryId)).length,
      settlementEntries: settlementEntries.filter((entry) => entry.documentId === document.id).length
    }
  };
}

export async function procurementCostRollbackPreviewFor(readContext: RuntimeReadContext, costId: ID): Promise<EntityRollbackPreview> {
  const [
    procurementCosts,
    documents,
    procurementCostLines,
    journalEntries,
    journalLines,
    payments
  ] = await Promise.all([
    readContext.repos.procurementCosts.all(),
    readContext.repos.documents.all(),
    readContext.repos.procurementCostLines.all(),
    readContext.repos.journalEntries.all(),
    readContext.repos.journalLines.all(),
    readContext.repos.payments.all()
  ]);
  const cost = mustFind(procurementCosts, costId, "procurement_cost_not_found");
  const document = mustFind(documents, cost.documentId, "document_not_found");
  const lines = procurementCostLines.filter((line) => line.procurementCostId === cost.id);
  const descendants = await documentDescendants(readContext, document.id);
  const blockers: EntityRollbackBlockerSummary[] = [];

  if (lines.some((line) => (line.soldCostAmountRub ?? 0) > 0 || (line.qtySold ?? 0) > 0)) {
    blockers.push({
      code: "procurement_cost_has_downstream_usage",
      message: "Нельзя удалить расход закупки: часть суммы уже отнесена на проданные товары"
    });
  }
  if (descendants.length > 0) {
    blockers.push({
      code: "document_has_descendants",
      message: "Сначала удалите зависимые документы этого расхода",
      relatedDocuments: rollbackRelatedFromDescendants(descendants)
    });
  }

  const journalEntryIds = new Set(journalEntries.filter((entry) => entry.documentId === document.id).map((entry) => entry.id));
  return {
    entityType: "procurement_cost",
    entityId: cost.id,
    documentId: document.id,
    documentNumber: document.number,
    title: document.title,
    status: cost.status,
    accountingDate: document.accountingDate,
    canDelete: blockers.length === 0,
    blockers,
    descendants,
    effects: {
      ...emptyRollbackEffects(),
      documents: 1,
      journalEntries: journalEntryIds.size,
      journalLines: journalLines.filter((line) => journalEntryIds.has(line.journalEntryId)).length,
      payments: payments.filter((payment) => payment.documentId === document.id).length
    }
  };
}

export async function paymentRollbackPreviewFor(readContext: RuntimeReadContext, paymentId: ID): Promise<EntityRollbackPreview> {
  const [
    payments,
    documents,
    paymentAllocations,
    receipts,
    payouts,
    journalEntries,
    journalLines,
    settlementEntries
  ] = await Promise.all([
    readContext.repos.payments.all(),
    readContext.repos.documents.all(),
    readContext.repos.paymentAllocations.all(),
    readContext.repos.goodsReceipts.all(),
    readContext.repos.payouts.all(),
    readContext.repos.journalEntries.all(),
    readContext.repos.journalLines.all(),
    readContext.repos.settlementEntries.all()
  ]);
  const payment = mustFind(payments, paymentId, "payment_not_found");
  const document = mustFind(documents, payment.documentId, "document_not_found");
  const descendants = await documentDescendants(readContext, document.id);
  const blockers: EntityRollbackBlockerSummary[] = [];

  if (descendants.length > 0) {
    blockers.push({
      code: "document_has_descendants",
      message: "Сначала удалите зависимые документы этой оплаты",
      relatedDocuments: rollbackRelatedFromDescendants(descendants)
    });
  }

  const allocation = paymentAllocations.find((candidate) => candidate.paymentId === payment.id && candidate.allocationPurpose === "goods_purchase");
  if (allocation?.purchaseOrderId) {
    const postedReceipts = receipts.filter((receipt) =>
      receipt.purchaseOrderId === allocation.purchaseOrderId &&
      receipt.status === "posted" &&
      documents.find((candidate) => candidate.id === receipt.documentId)?.status === "posted"
    );
    if (postedReceipts.length > 0) {
      blockers.push({
        code: "payment_consumed_by_receipt",
        message: "Нельзя удалить оплату: по заказу уже проведена приёмка, которая зачла этот аванс. Сначала удалите приёмку.",
        relatedDocuments: (await Promise.all(
          postedReceipts.map((receipt) => findRollbackDocumentSummary(readContext, receipt.documentId))
        )).filter((item): item is RollbackRelatedDocumentSummary => Boolean(item))
      });
    }
  }

  if (payment.paymentType === "channel_payout" && payouts.some((payout) => payout.paymentId === payment.id)) {
    blockers.push({
      code: "payment_belongs_to_payout",
      message: "Оплата относится к выплате маркетплейса — управляйте ею в разделе «Выплаты»."
    });
  }

  const journalEntryIds = new Set(journalEntries.filter((entry) => entry.documentId === document.id).map((entry) => entry.id));
  return {
    entityType: "payment",
    entityId: payment.id,
    documentId: document.id,
    documentNumber: document.number,
    title: document.title,
    status: document.status === "posted" ? "posted" : document.status,
    accountingDate: document.accountingDate,
    canDelete: blockers.length === 0,
    blockers,
    descendants,
    effects: {
      ...emptyRollbackEffects(),
      documents: 1,
      payments: 1,
      journalEntries: journalEntryIds.size,
      journalLines: journalLines.filter((line) => journalEntryIds.has(line.journalEntryId)).length,
      settlementEntries: settlementEntries.filter((entry) => entry.documentId === document.id).length,
      paymentAllocations: paymentAllocations.filter((candidate) => candidate.paymentId === payment.id).length
    }
  };
}

export async function stockTransferRollbackPreviewFor(readContext: RuntimeReadContext, transferId: ID): Promise<EntityRollbackPreview> {
  const [
    transfers,
    documents,
    journalEntries,
    journalLines,
    settlementEntries,
    stockMovements,
    inventoryLots,
    costApplications
  ] = await Promise.all([
    readContext.repos.stockTransfers.all(),
    readContext.repos.documents.all(),
    readContext.repos.journalEntries.all(),
    readContext.repos.journalLines.all(),
    readContext.repos.settlementEntries.all(),
    readContext.repos.stockMovements.all(),
    readContext.repos.inventoryLots.all(),
    readContext.repos.costApplications.all()
  ]);
  const transfer = mustFind(transfers, transferId, "transfer_not_found");
  const document = mustFind(documents, transfer.documentId, "document_not_found");
  const descendants = await documentDescendants(readContext, document.id);
  const downstreamDocuments = await inventoryUsageDocuments(readContext, document.id);
  const blockers: EntityRollbackBlockerSummary[] = [];

  if (descendants.length > 0) {
    blockers.push({
      code: "document_has_descendants",
      message: "Сначала удалите зависимые документы этого перемещения",
      relatedDocuments: rollbackRelatedFromDescendants(descendants)
    });
  }
  if (downstreamDocuments.length > 0) {
    blockers.push({
      code: "stock_transfer_has_downstream_usage",
      message: "Нельзя удалить перемещение: товар из него уже использован в других операциях",
      relatedDocuments: downstreamDocuments
    });
  }

  const removableDocumentIds = new Set<ID>([document.id]);
  const journalEntryIds = new Set(journalEntries.filter((entry) => removableDocumentIds.has(entry.documentId)).map((entry) => entry.id));
  return {
    entityType: "stock_transfer",
    entityId: transfer.id,
    documentId: document.id,
    documentNumber: document.number,
    title: document.title,
    status: transfer.status,
    accountingDate: document.accountingDate,
    canDelete: blockers.length === 0,
    blockers,
    descendants,
    effects: {
      documents: removableDocumentIds.size,
      journalEntries: journalEntryIds.size,
      journalLines: journalLines.filter((line) => journalEntryIds.has(line.journalEntryId)).length,
      settlementEntries: settlementEntries.filter((entry) => removableDocumentIds.has(entry.documentId)).length,
      stockMovements: stockMovements.filter((movement) => movement.documentId === document.id).length,
      inventoryLots: inventoryLots.filter((lot) => lot.sourceDocumentId === document.id).length,
      costApplications: costApplications.filter((application) => application.outboundDocumentId === document.id).length,
      saleLines: 0,
      financeEvents: 0,
      stockTransfers: 1,
      payments: 0,
      paymentAllocations: 0,
      externalEventsToReset: 0
    }
  };
}

export async function saleRollbackPreviewFor(readContext: RuntimeReadContext, saleId: ID): Promise<EntityRollbackPreview> {
  const [
    sales,
    documents,
    returns,
    financeEvents,
    payoutLines,
    journalEntries,
    journalLines,
    settlementEntries,
    stockMovements,
    costApplications,
    saleLines
  ] = await Promise.all([
    readContext.repos.sales.all(),
    readContext.repos.documents.all(),
    readContext.repos.salesReturns.all(),
    readContext.repos.channelFinanceEvents.all(),
    readContext.repos.payoutLines.all(),
    readContext.repos.journalEntries.all(),
    readContext.repos.journalLines.all(),
    readContext.repos.settlementEntries.all(),
    readContext.repos.stockMovements.all(),
    readContext.repos.costApplications.all(),
    readContext.repos.saleLines.all()
  ]);
  const sale = mustFind(sales, saleId, "sale_not_found");
  const document = mustFind(documents, sale.documentId, "document_not_found");
  const linkedReturns = returns.filter((candidate) => candidate.saleId === sale.id);
  const linkedFinanceEvents = financeEvents.filter((event) =>
    event.linkedSaleId === sale.id || Boolean(event.saleAllocations?.some((allocation) => allocation.saleId === sale.id))
  );
  const sharedFinanceEvents = linkedFinanceEvents.filter((event) =>
    Boolean(event.saleAllocations?.some((allocation) => allocation.saleId !== sale.id))
  );
  const blockedByPayout = payoutLines.some((line) =>
    (line.sourceType === "sale" && line.sourceId === sale.id) ||
    (line.sourceType === "finance_event" && linkedFinanceEvents.some((event) => event.id === line.sourceId))
  );
  const blockers: EntityRollbackBlockerSummary[] = [];

  if (linkedReturns.length > 0) {
    blockers.push({
      code: "sale_has_returns",
      message: "Сначала удалите возвраты по этой продаже",
      relatedDocuments: (await Promise.all(
        linkedReturns.map((salesReturn) => findRollbackDocumentSummary(readContext, salesReturn.documentId))
      )).filter((item): item is RollbackRelatedDocumentSummary => Boolean(item))
    });
  }
  if (sharedFinanceEvents.length > 0) {
    blockers.push({
      code: "sale_has_shared_finance_events",
      message: "Сначала удалите распределенные финансовые операции, которые относятся сразу к нескольким продажам",
      relatedDocuments: (await Promise.all(
        sharedFinanceEvents.map((event) => findRollbackDocumentSummary(readContext, event.documentId))
      )).filter((item): item is RollbackRelatedDocumentSummary => Boolean(item))
    });
  }
  if (blockedByPayout) {
    blockers.push({
      code: "sale_has_payouts",
      message: "Нельзя удалить продажу, которая уже вошла в выплату маркетплейса"
    });
  }

  const resetExternalEventIds = await saleResetExternalEventIds(readContext, sale, linkedFinanceEvents);
  const removableDocumentIds = new Set<ID>([
    sale.documentId,
    ...linkedFinanceEvents.map((event) => event.documentId),
    ...[sale.financialDocumentId].filter(Boolean) as ID[]
  ]);
  const journalEntryIds = new Set(journalEntries.filter((entry) => removableDocumentIds.has(entry.documentId)).map((entry) => entry.id));
  const saleCostApplications = costApplications.filter((application) =>
    application.outboundDocumentId === sale.documentId && application.applicationType === "sale"
  );
  const descendants = await documentDescendants(readContext, document.id);

  return {
    entityType: "sale",
    entityId: sale.id,
    documentId: document.id,
    documentNumber: document.number,
    title: document.title,
    status: sale.status,
    accountingDate: document.accountingDate,
    canDelete: blockers.length === 0,
    blockers,
    descendants,
    effects: {
      documents: removableDocumentIds.size,
      journalEntries: journalEntryIds.size,
      journalLines: journalLines.filter((line) => journalEntryIds.has(line.journalEntryId)).length,
      settlementEntries: settlementEntries.filter((entry) => removableDocumentIds.has(entry.documentId)).length,
      stockMovements: stockMovements.filter((movement) => movement.documentId === sale.documentId).length,
      inventoryLots: 0,
      costApplications: saleCostApplications.length,
      saleLines: saleLines.filter((line) => line.saleId === sale.id).length,
      financeEvents: linkedFinanceEvents.length,
      stockTransfers: 0,
      payments: 0,
      paymentAllocations: 0,
      externalEventsToReset: resetExternalEventIds.size
    }
  };
}

export async function shortagePreviewFor(readContext: RuntimeReadContext, purchaseOrderId: ID) {
  const [
    purchaseOrders,
    purchaseOrderLines,
    documents,
    receipts,
    receiptLines,
    shortageResolutions,
    shortageResolutionLines,
    paymentAllocations,
    payments
  ] = await Promise.all([
    readContext.repos.purchaseOrders.all(),
    readContext.repos.purchaseOrderLines.all(),
    readContext.repos.documents.all(),
    readContext.repos.goodsReceipts.all(),
    readContext.repos.goodsReceiptLines.all(),
    readContext.repos.shortageResolutions.all(),
    readContext.repos.shortageResolutionLines.all(),
    readContext.repos.paymentAllocations.all(),
    readContext.repos.payments.all()
  ]);
  const order = mustFind(purchaseOrders, purchaseOrderId, "purchase_order_not_found");
  const orderLines = purchaseOrderLines.filter((line) => line.purchaseOrderId === order.id);
  const postedReceiptIds = new Set(
    receipts
      .filter((receipt) => receipt.status === "posted" && documents.find((document) => document.id === receipt.documentId)?.status === "posted")
      .map((receipt) => receipt.id)
  );
  const shortageLines = orderLines.map((line) => {
    const qtyReceived = round4(
      receiptLines
        .filter((receiptLine) => receiptLine.purchaseOrderLineId === line.id && postedReceiptIds.has(receiptLine.goodsReceiptId))
        .reduce((sum, receiptLine) => sum + receiptLine.qtyReceived, 0)
    );
    const qtyShortage = openShortageQtyForLine({
      orderId: order.id,
      line,
      qtyReceived,
      shortageResolutions,
      shortageResolutionLines
    });
    return {
      purchaseOrderLineId: line.id,
      productId: line.productId,
      qtyOrdered: line.qtyOrdered,
      qtyReceived,
      qtyShortage,
      paidShareRub: paidShareForOrderLine({
        orderId: order.id,
        line,
        qty: qtyShortage,
        orderLines,
        paymentAllocations,
        payments,
        documents
      })
    };
  }).filter((line) => line.qtyShortage > 0);
  return { purchaseOrderId: order.id, lines: shortageLines };
}

async function documentDescendants(readContext: RuntimeReadContext, documentId: ID): Promise<DocumentDescendantSummary[]> {
  const [documents, documentTypes, documentLinks] = await Promise.all([
    readContext.repos.documents.all(),
    readContext.repos.documentTypes.all(),
    readContext.repos.documentLinks.all()
  ]);
  mustFind(documents, documentId, "document_not_found");
  const documentTypesByCode = new Map(documentTypes.map((documentType) => [documentType.code, documentType.displayName]));
  const queue: Array<{ documentId: ID; depth: number }> = [{ documentId, depth: 0 }];
  const visited = new Set<ID>([documentId]);
  const descendants: DocumentDescendantSummary[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const link of documentLinks) {
      const descendantId = documentDescendantIdForLink(link, current.documentId);
      if (!descendantId || visited.has(descendantId)) continue;
      const descendant = documents.find((candidate) => candidate.id === descendantId);
      if (!descendant) continue;
      visited.add(descendantId);
      descendants.push({
        documentId: descendant.id,
        number: descendant.number,
        title: descendant.title,
        documentType: descendant.documentType,
        documentTypeName: documentTypesByCode.get(descendant.documentType) ?? descendant.documentType,
        status: descendant.status,
        accountingDate: descendant.accountingDate,
        linkType: link.linkType,
        parentDocumentId: current.documentId,
        depth: current.depth + 1
      });
      queue.push({ documentId: descendant.id, depth: current.depth + 1 });
    }
  }

  return descendants.sort((left, right) =>
    left.depth - right.depth ||
    left.accountingDate.localeCompare(right.accountingDate) ||
    left.number.localeCompare(right.number)
  );
}

async function findRollbackDocumentSummary(readContext: RuntimeReadContext, documentId: ID): Promise<RollbackRelatedDocumentSummary | undefined> {
  const [documents, documentTypes] = await Promise.all([
    readContext.repos.documents.all(),
    readContext.repos.documentTypes.all()
  ]);
  const document = documents.find((candidate) => candidate.id === documentId);
  if (!document) return undefined;
  return {
    documentId: document.id,
    number: document.number,
    title: document.title,
    documentType: document.documentType,
    documentTypeName: documentTypes.find((candidate) => candidate.code === document.documentType)?.displayName ?? document.documentType,
    status: document.status,
    accountingDate: document.accountingDate
  };
}

async function inventoryUsageDocuments(readContext: RuntimeReadContext, sourceDocumentId: ID): Promise<RollbackRelatedDocumentSummary[]> {
  const outboundDocumentIds = new Set(
    (await readContext.repos.costApplications.all())
      .filter((application) => application.sourceDocumentId === sourceDocumentId && application.outboundDocumentId !== sourceDocumentId)
      .map((application) => application.outboundDocumentId)
  );
  return (await Promise.all([...outboundDocumentIds]
    .map((documentId) => findRollbackDocumentSummary(readContext, documentId))))
    .filter((item): item is RollbackRelatedDocumentSummary => Boolean(item))
    .sort((left, right) =>
      left.accountingDate.localeCompare(right.accountingDate) ||
      left.number.localeCompare(right.number)
    );
}

async function saleResetExternalEventIds(readContext: RuntimeReadContext, sale: Sale, linkedFinanceEvents: ChannelFinanceEvent[]): Promise<Set<ID>> {
  const resetExternalEventIds = new Set<ID>();
  if (sale.externalEventId) resetExternalEventIds.add(sale.externalEventId);
  linkedFinanceEvents.forEach((event) => {
    if (event.externalEventId) resetExternalEventIds.add(event.externalEventId);
  });
  if (sale.financialDocumentId) {
    (await readContext.externalEvents.list())
      .filter((event) => event.materializedDocumentId === sale.financialDocumentId)
      .forEach((event) => resetExternalEventIds.add(event.id));
  }
  return resetExternalEventIds;
}

function rollbackRelatedFromDescendants(descendants: DocumentDescendantSummary[]): RollbackRelatedDocumentSummary[] {
  return descendants.map((descendant) => ({
    documentId: descendant.documentId,
    number: descendant.number,
    title: descendant.title,
    documentType: descendant.documentType,
    documentTypeName: descendant.documentTypeName,
    status: descendant.status,
    accountingDate: descendant.accountingDate
  }));
}

function documentDescendantIdForLink(link: DocumentLink, currentDocumentId: ID): ID | undefined {
  switch (link.linkType) {
    case "payment":
    case "channel_fee":
      return link.toDocumentId === currentDocumentId ? link.fromDocumentId : undefined;
    case "sale_finance":
    case "return":
    case "receipt":
    case "procurement_cost":
    case "shortage":
    case "correction":
    default:
      return link.fromDocumentId === currentDocumentId ? link.toDocumentId : undefined;
  }
}

function openShortageQtyForLine(input: {
  orderId: ID;
  line: PurchaseOrderLine;
  qtyReceived: number;
  shortageResolutions: Array<{ purchaseOrderId: ID; status: string; id: ID }>;
  shortageResolutionLines: Array<{ shortageResolutionId: ID; purchaseOrderLineId: ID; qtyShortage: number }>;
}): number {
  const resolvedQty = round4(
    input.shortageResolutions
      .filter((resolution) => resolution.purchaseOrderId === input.orderId && resolution.status === "posted")
      .flatMap((resolution) => input.shortageResolutionLines.filter((candidate) => candidate.shortageResolutionId === resolution.id))
      .filter((candidate) => candidate.purchaseOrderLineId === input.line.id)
      .reduce((sum, candidate) => sum + candidate.qtyShortage, 0)
  );
  return round4(Math.max(0, input.line.qtyOrdered - input.qtyReceived - resolvedQty));
}

function paidShareForOrderLine(input: {
  orderId: ID;
  line: PurchaseOrderLine;
  qty: number;
  orderLines: PurchaseOrderLine[];
  paymentAllocations: Array<{ purchaseOrderId?: ID; allocationPurpose: string; paymentId: ID; amountRub: number }>;
  payments: Array<{ id: ID; documentId: ID }>;
  documents: Array<{ id: ID; status: string }>;
}): number {
  const linkedGoodsPaymentRub = input.paymentAllocations
    .filter((allocation) =>
      allocation.purchaseOrderId === input.orderId &&
      allocation.allocationPurpose === "goods_purchase" &&
      paymentAllocationPosted(allocation.paymentId, input.payments, input.documents)
    )
    .reduce((sum, allocation) => round2(sum + allocation.amountRub), 0);
  const totalBasis = input.orderLines.reduce((sum, line) => sum + line.supplierAmount, 0);
  const lineBasis = input.qty * input.line.supplierUnitPrice;
  return totalBasis > 0 ? round2((linkedGoodsPaymentRub * lineBasis) / totalBasis) : 0;
}

function paymentAllocationPosted(paymentId: ID, payments: Array<{ id: ID; documentId: ID }>, documents: Array<{ id: ID; status: string }>) {
  const payment = payments.find((candidate) => candidate.id === paymentId);
  return payment ? documents.find((document) => document.id === payment.documentId)?.status === "posted" : false;
}

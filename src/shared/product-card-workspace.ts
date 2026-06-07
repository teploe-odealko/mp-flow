type Row = Record<string, any>;

export interface ProductCardWorkspaceInput {
  accountingPolicy?: Row;
  products: Row[];
  warehouses: Row[];
  documents: Row[];
  journalEntries: Row[];
  costApplications: Row[];
  externalProducts: Row[];
  productExternalLinks: Row[];
  salesChannels: Row[];
  inventoryLots: Row[];
  stockMovements: Row[];
  stockStates: Row[];
  purchaseOrders: Row[];
  purchaseOrderLines: Row[];
  externalEvents: Row[];
}

export function buildProductCardWorkspacePayload(input: ProductCardWorkspaceInput, productId: string) {
  const product = input.products.find((candidate) => candidate.id === productId);
  const lots = input.inventoryLots.filter((lot) => lot.productId === productId);
  const movements = input.stockMovements.filter((movement) => movement.productId === productId);
  const balances = input.stockStates.filter((stock) => stock.productId === productId);
  const lotIds = new Set(lots.map((lot) => lot.id));
  const costApplications = input.costApplications.filter((application) => application.productId === productId || lotIds.has(application.fromLotId));
  const productExternalLinks = input.productExternalLinks.filter((link) => link.productId === productId);
  const externalProductIds = new Set(productExternalLinks.map((link) => link.externalProductId));
  const channelIds = new Set(productExternalLinks.map((link) => link.channelId));
  const purchaseOrderLines = input.purchaseOrderLines.filter((line) => line.productId === productId);
  const purchaseOrderIds = new Set(purchaseOrderLines.map((line) => line.purchaseOrderId));
  const purchaseOrders = input.purchaseOrders.filter((order) => purchaseOrderIds.has(order.id));
  const documentIds = new Set<string>();

  for (const lot of lots) addId(documentIds, lot.sourceDocumentId);
  for (const movement of movements) addId(documentIds, movement.documentId);
  for (const application of costApplications) {
    addId(documentIds, application.sourceDocumentId);
    addId(documentIds, application.outboundDocumentId);
  }
  for (const order of purchaseOrders) addId(documentIds, order.documentId);

  const documents = input.documents.filter((document) => documentIds.has(document.id));
  const journalEntries = input.journalEntries.filter((entry) => documentIds.has(entry.documentId));
  const warehouseIds = new Set<string>();
  for (const lot of lots) addId(warehouseIds, lot.warehouseId);
  for (const movement of movements) addId(warehouseIds, movement.warehouseId);
  for (const stock of balances) addId(warehouseIds, stock.warehouseId);

  return {
    product,
    warehouses: input.warehouses.filter((warehouse) => warehouseIds.has(warehouse.id)),
    documents,
    journalEntries,
    costApplications,
    externalProducts: input.externalProducts.filter((external) => externalProductIds.has(external.id)),
    externalLinks: productExternalLinks,
    salesChannels: input.salesChannels.filter((channel) => channelIds.has(channel.id)),
    lots,
    movements,
    balances,
    accountingPolicy: input.accountingPolicy,
    unresolvedExternalEvents: input.externalEvents.filter((event) =>
      event.productId === productId &&
      event.status !== "processed" &&
      event.status !== "ignored"
    )
  };
}

function addId(target: Set<string>, value: unknown) {
  if (typeof value === "string" && value.length > 0) target.add(value);
}

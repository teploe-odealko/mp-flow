import { Link } from "react-router-dom";
import { AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { date } from "@/lib/format";

export type RollbackDocumentSummary = {
  documentId: string;
  number: string;
  title: string;
  documentType: string;
  documentTypeName: string;
  status: "draft" | "posted" | "cancelled";
  accountingDate: string;
};

export type RollbackBlockerSummary = {
  code: string;
  message: string;
  relatedDocuments?: RollbackDocumentSummary[];
};

export type RollbackDescendantSummary = RollbackDocumentSummary & {
  linkType: string;
  parentDocumentId: string;
  depth: number;
};

export type EntityRollbackPreview = {
  entityType: "sale" | "stock_transfer" | "payment" | "goods_receipt" | "procurement_cost";
  entityId: string;
  documentId: string;
  documentNumber: string;
  title: string;
  status: string;
  accountingDate: string;
  canDelete: boolean;
  blockers: RollbackBlockerSummary[];
  descendants: RollbackDescendantSummary[];
  effects: {
    documents: number;
    journalEntries: number;
    journalLines: number;
    settlementEntries: number;
    stockMovements: number;
    inventoryLots: number;
    costApplications: number;
    saleLines: number;
    financeEvents: number;
    stockTransfers: number;
    payments: number;
    paymentAllocations: number;
    externalEventsToReset: number;
  };
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  preview?: EntityRollbackPreview;
  previewLoading?: boolean;
  errorMessage?: string;
  onConfirm: () => void;
  confirmLabel: string;
  confirmPending?: boolean;
  warning?: string;
};

export function EntityDeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  preview,
  previewLoading,
  errorMessage,
  onConfirm,
  confirmLabel,
  confirmPending,
  warning
}: Props) {
  const effectRows = preview ? rollbackEffectRows(preview.effects) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {warning && (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/30 p-3 text-sm">
              {warning}
            </div>
          )}

          {previewLoading && (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-muted)]/20 p-4 text-sm text-[var(--color-muted-foreground)]">
              Считаем последствия удаления…
            </div>
          )}

          {preview && !previewLoading && (
            <>
              {preview.canDelete ? (
                <>
                  <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
                    <div className="mb-2 text-sm font-medium">Будет удалено</div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      {effectRows.length === 0 ? (
                        <div className="text-sm text-[var(--color-muted-foreground)]">У сущности нет материальных следов для удаления.</div>
                      ) : (
                        effectRows.map((row) => (
                          <div key={row.label} className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] bg-[var(--color-muted)]/30 px-3 py-2 text-sm">
                            <span>{row.label}</span>
                            <span className="font-semibold">{row.value}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {preview.descendants.length > 0 && (
                    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
                      <div className="mb-2 text-sm font-medium">Связанные документы тоже уйдут</div>
                      <div className="space-y-2">
                        {preview.descendants.map((descendant) => (
                          <div key={descendant.documentId} className="flex items-start justify-between gap-3 text-sm">
                            <div className="min-w-0">
                              <Link to={`/documents/${descendant.documentId}`} className="font-mono font-semibold text-[var(--color-primary)] hover:underline">
                                {descendant.number}
                              </Link>
                              <div className="text-[var(--color-muted-foreground)]">{descendant.title}</div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <Badge tone="neutral">{descendant.documentTypeName}</Badge>
                              <span className="text-xs text-[var(--color-muted-foreground)]">{date(descendant.accountingDate)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)] bg-[var(--color-danger-soft)] p-3">
                  <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--color-danger)]">
                    <AlertTriangle size={14} />
                    Сейчас удалить нельзя
                  </div>
                  <div className="space-y-3">
                    {preview.blockers.map((blocker) => (
                      <div key={`${blocker.code}-${blocker.message}`} className="space-y-2 text-sm">
                        <div className="text-[var(--color-danger)]">{blocker.message}</div>
                        {(blocker.relatedDocuments?.length ?? 0) > 0 && (
                          <div className="space-y-2 rounded-[var(--radius-sm)] bg-white/60 p-3">
                            {blocker.relatedDocuments!.map((document) => (
                              <div key={document.documentId} className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <Link to={`/documents/${document.documentId}`} className="font-mono font-semibold text-[var(--color-primary)] hover:underline">
                                    {document.number}
                                  </Link>
                                  <div className="text-[var(--color-muted-foreground)]">{document.title}</div>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                  <Badge tone="neutral">{document.documentTypeName}</Badge>
                                  <span className="text-xs text-[var(--color-muted-foreground)]">{date(document.accountingDate)}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {errorMessage && <p className="text-sm text-[var(--color-danger)]">{errorMessage}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button variant="destructive" onClick={onConfirm} disabled={confirmPending || previewLoading || (preview ? !preview.canDelete : false)}>
            <Trash2 size={14} /> {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function rollbackEffectRows(effects: EntityRollbackPreview["effects"]) {
  const rawRows: Array<[string, number]> = [
    ["Документы", effects.documents],
    ["Проводки", effects.journalEntries],
    ["Строки проводок", effects.journalLines],
    ["Складские движения", effects.stockMovements],
    ["Партии", effects.inventoryLots],
    ["FIFO-списания", effects.costApplications],
    ["Строки продаж", effects.saleLines],
    ["Финансовые события", effects.financeEvents],
    ["Перемещения", effects.stockTransfers],
    ["Платежи", effects.payments],
    ["Распределения платежей", effects.paymentAllocations],
    ["Расчетные записи", effects.settlementEntries],
    ["События для пересинка", effects.externalEventsToReset]
  ];
  const rows: Array<{ label: string; value: number }> = rawRows.map(([label, value]) => ({ label, value: Number(value) }));
  return rows.filter((row) => row.value > 0);
}

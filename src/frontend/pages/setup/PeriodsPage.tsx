import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Lock, Unlock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogClose
} from "@/components/ui/dialog";
import { useAppState } from "@/lib/use-app-state";
import { apiPost } from "@/api";
import { date, dateTime } from "@/lib/format";
import { periodStatusLabel } from "@/lib/i18n";
import { Kpi } from "@/components/ui/kpi";

export function PeriodsPage() {
  const { state } = useAppState();
  const periods = state.periods ?? [];
  const queryClient = useQueryClient();
  const [closeId, setCloseId] = useState<string | null>(null);
  const [reopenId, setReopenId] = useState<string | null>(null);

  const closeMutation = useMutation({
    mutationFn: (id: string) => apiPost(`/api/periods/${id}/close`),
    onSuccess: () => {
      queryClient.invalidateQueries();
      setCloseId(null);
    }
  });
  const reopenMutation = useMutation({
    mutationFn: (id: string) => apiPost(`/api/periods/${id}/reopen`),
    onSuccess: () => {
      queryClient.invalidateQueries();
      setReopenId(null);
    }
  });

  const closeTarget = periods.find((p: any) => p.id === closeId);
  const reopenTarget = periods.find((p: any) => p.id === reopenId);
  const currentPeriod = periods.find((p: any) => p.status === "open");
  const closedPeriods = periods.filter((p: any) => p.status === "closed").length;
  const accountingPolicy = state.accountingPolicy;

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-5">
      <PageHeader
        title="Учётные периоды"
        subtitle="Закрытие защищает журнал и складские движения от прямого редактирования"
        breadcrumbs={[{ label: "Настройки", to: "/settings" }, { label: "Периоды" }]}
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Kpi tone="primary" label="Текущий период" value={currentPeriod?.label ?? "—"} />
        <Kpi tone="neutral" label="Закрыто периодов" value={closedPeriods} />
        <Kpi tone="info" label="Метод себестоимости" value={String(accountingPolicy?.costMethod ?? "FIFO").toUpperCase()} />
        <Kpi tone="success" label="Налоговый режим" value={state.organization?.taxMode === "usn_income_expense" ? "УСН Д-Р" : "—"} />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <THead>
              <TR>
                <TH>Период</TH>
                <TH>Начало</TH>
                <TH>Конец</TH>
                <TH>Статус</TH>
                <TH>Закрыт</TH>
                <TH>Действие</TH>
              </TR>
            </THead>
            <TBody>
              {periods.map((p: any) => (
                <TR key={p.id}>
                  <TD>
                    <div className="font-semibold flex items-center gap-2">
                      <CalendarDays size={14} className="text-[var(--color-muted-foreground)]" />
                      {p.label}
                    </div>
                  </TD>
                  <TD muted className="numeric">{date(p.startsOn)}</TD>
                  <TD muted className="numeric">{date(p.endsOn)}</TD>
                  <TD>
                    <Badge tone={p.status === "open" ? "success" : "neutral"}>
                      {periodStatusLabel[p.status]}
                    </Badge>
                  </TD>
                  <TD muted className="numeric">{p.closedAt ? dateTime(p.closedAt) : "—"}</TD>
                  <TD>
                    {p.status === "open" ? (
                      <Button size="sm" variant="secondary" onClick={() => setCloseId(p.id)}>
                        <Lock size={13} /> Закрыть
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setReopenId(p.id)}>
                        <Unlock size={13} /> Переоткрыть
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4 text-sm text-[var(--color-muted-foreground)] leading-relaxed">
          Дата старта учета: <span className="font-semibold text-[var(--color-foreground)]">{date(accountingPolicy?.accountingStartDate)}</span>. Она задает границу, с которой MPFlow становится источником учетной правды.
        </CardContent>
      </Card>

      <Dialog open={Boolean(closeId)} onOpenChange={(o) => !o && setCloseId(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Закрыть период {closeTarget?.label}?</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="text-sm text-[var(--color-muted-foreground)]">
              После закрытия документы и проводки этого периода нельзя будет редактировать напрямую. Корректировки делаются через документ-сторно.
            </p>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Отмена</Button>
            </DialogClose>
            <Button
              onClick={() => closeId && closeMutation.mutate(closeId)}
              disabled={closeMutation.isPending}
            >
              Закрыть период
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(reopenId)} onOpenChange={(o) => !o && setReopenId(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Переоткрыть период {reopenTarget?.label}?</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <p className="text-sm text-[var(--color-muted-foreground)]">
              Период станет редактируемым. Это нужно только для существенных корректировок — обычно используйте сторно.
            </p>
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">Отмена</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => reopenId && reopenMutation.mutate(reopenId)}
              disabled={reopenMutation.isPending}
            >
              Переоткрыть
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

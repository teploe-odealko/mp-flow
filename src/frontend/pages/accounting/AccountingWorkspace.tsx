import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BookOpen, FileText, Landmark, Sigma } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Kpi } from "@/components/ui/kpi";
import { Button } from "@/components/ui/button";
import { apiGet } from "@/api";
import { rub } from "@/lib/format";

export function AccountingWorkspace() {
  const workspaceQuery = useQuery({
    queryKey: ["accounting-journal-workspace"],
    queryFn: () => apiGet<{ entries: any[]; lines: any[]; accounts: any[] }>("/api/accounting/journal/workspace")
  });
  const journalEntries = workspaceQuery.data?.entries ?? [];
  const journalLines = workspaceQuery.data?.lines ?? [];
  const accounts = workspaceQuery.data?.accounts ?? [];
  const totalDebit = journalLines.reduce((s: number, l: any) => s + l.debit, 0);
  const totalCredit = journalLines.reduce((s: number, l: any) => s + l.credit, 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Бухгалтерское ядро"
        subtitle="План счетов, журнал операций и главная книга — основа учётной модели"
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi tone="primary" icon={<Landmark size={18} />} label="Счетов" value={accounts.length} />
        <Kpi tone="info" icon={<FileText size={18} />} label="Записей журнала" value={journalEntries.length} />
        <Kpi tone="neutral" icon={<Sigma size={18} />} label="Оборот Дебет" value={rub(totalDebit)} />
        <Kpi
          tone={balanced ? "success" : "danger"}
          icon={<Sigma size={18} />}
          label={balanced ? "Баланс сходится" : "Расхождение"}
          value={rub(totalCredit)}
          hint={balanced ? "Дебет = Кредит" : `Δ ${rub(Math.abs(totalDebit - totalCredit))}`}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <ShortcutCard
          title="План счетов"
          description="Системные счета, по которым движется учёт"
          to="/settings/chart-accounts"
          icon={<Landmark size={18} />}
        />
        <ShortcutCard
          title="Журнал операций"
          description="Хронологический поток сбалансированных проводок"
          to="/reports/journal"
          icon={<BookOpen size={18} />}
        />
        <ShortcutCard
          title="Главная книга"
          description="Обороты и остатки по выбранному счёту"
          to="/reports/ledger"
          icon={<Sigma size={18} />}
        />
      </div>
    </div>
  );
}

function ShortcutCard({
  title,
  description,
  to,
  icon
}: {
  title: string;
  description: string;
  to: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">{icon} {title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <Button asChild variant="ghost">
          <Link to={to}>
            Открыть <ArrowRight size={14} />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

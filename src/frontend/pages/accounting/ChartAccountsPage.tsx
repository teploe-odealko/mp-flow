import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, ArrowUpRight } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { CheckLabel } from "@/components/ui/checkbox";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCollection } from "@/lib/use-collection";
import { accountKindLabel } from "@/lib/i18n";
import { cn } from "@/lib/cn";

export function ChartAccountsPage() {
  const accounts = useCollection<any[]>("chartAccounts") ?? [];
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("");
  const [activeOnly, setActiveOnly] = useState(true);
  const [selectedCode, setSelectedCode] = useState<string | null>(accounts[0]?.code ?? null);
  const navigate = useNavigate();

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return accounts.filter((a: any) => {
      if (activeOnly && a.isActive === false) return false;
      if (kind && a.kind !== kind) return false;
      if (q && !`${a.code} ${a.name}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [accounts, search, kind, activeOnly]);

  const lines = useCollection<any[]>("journalLines") ?? [];
  const selected = filtered.find((a: any) => a.code === selectedCode) ?? filtered[0];
  const accountStats = useMemo(() => {
    if (!selected) return null;
    const accountLines = lines.filter((l: any) => l.accountCode === selected.code);
    const debit = accountLines.reduce((s: number, l: any) => s + l.debit, 0);
    const credit = accountLines.reduce((s: number, l: any) => s + l.credit, 0);
    return { debit, credit, balance: debit - credit, count: accountLines.length };
  }, [selected, lines]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="План счетов"
        subtitle="Управленческий план счетов под reseller-цикл — read-only"
        breadcrumbs={[{ label: "Учёт", to: "/accounting" }, { label: "План счетов" }]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
        <Card>
          <CardContent className="p-0">
            <div className="flex flex-wrap items-center gap-2 p-3 border-b border-[var(--color-border)]">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
                <Input
                  className="pl-9"
                  placeholder="Поиск по коду или названию"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select aria-label="Тип счета" value={kind} onChange={(e) => setKind(e.target.value)} className="w-44">
                <option value="">Все типы</option>
                {Object.entries(accountKindLabel).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </Select>
              <CheckLabel
                checked={activeOnly}
                onCheckedChange={setActiveOnly}
                label="Только активные"
              />
            </div>

            <Table>
              <THead>
                <TR>
                  <TH className="w-24">Код</TH>
                  <TH>Название</TH>
                  <TH className="w-32">Тип</TH>
                  <TH className="w-20">Активен</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((account: any) => (
                  <TR
                    key={account.code}
                    interactive
                    selected={account.code === selected?.code}
                    onClick={() => setSelectedCode(account.code)}
                  >
                    <TD>
                      <span className="font-mono text-sm font-semibold">{account.code}</span>
                    </TD>
                    <TD>{account.name}</TD>
                    <TD>
                      <Badge tone="neutral">{accountKindLabel[account.kind] ?? account.kind}</Badge>
                    </TD>
                    <TD>
                      {account.isActive !== false ? (
                        <Badge tone="success">Да</Badge>
                      ) : (
                        <Badge tone="neutral">Нет</Badge>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="h-fit sticky top-20">
          {selected ? (
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-mono text-2xl font-bold">{selected.code}</div>
                  <div className="text-sm font-medium mt-1 text-balance">{selected.name}</div>
                </div>
                <Badge tone="primary">{accountKindLabel[selected.kind] ?? selected.kind}</Badge>
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <Stat label="Сторона" value={selected.normalSide === "debit" ? "Дебетовый" : "Кредитовый"} />
                <Stat label="Записей" value={accountStats?.count ?? 0} />
                <Stat label="Дебет" value={(accountStats?.debit ?? 0).toLocaleString("ru-RU")} className={cn(selected.normalSide === "debit" && "text-[var(--color-foreground)]")} />
                <Stat label="Кредит" value={(accountStats?.credit ?? 0).toLocaleString("ru-RU")} />
              </dl>
              <Button
                variant="secondary"
                onClick={() => navigate(`/reports/ledger?account=${selected.code}`)}
              >
                Открыть в главной книге <ArrowUpRight size={14} />
              </Button>
            </CardContent>
          ) : (
            <CardContent className="text-sm text-[var(--color-muted-foreground)] py-12 text-center">
              Выберите счёт, чтобы увидеть детали
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-[var(--radius-md)] bg-[var(--color-muted)]/50 p-2.5", className)}>
      <dt className="text-[10px] uppercase tracking-wide font-semibold text-[var(--color-muted-foreground)]">{label}</dt>
      <dd className="text-base font-semibold mt-0.5 numeric">{value}</dd>
    </div>
  );
}

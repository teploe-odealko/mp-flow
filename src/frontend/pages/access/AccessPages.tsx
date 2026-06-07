import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/api";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { dateTime } from "@/lib/format";

export function AuditPage() {
  const auditQuery = useQuery({ queryKey: ["audit-events"], queryFn: () => apiGet<any[]>("/api/controls/audit-events") });
  const auditEvents = auditQuery.data ?? [];
  const [periodFilter, setPeriodFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [objectFilter, setObjectFilter] = useState("");
  const [severityFilter, setSeverityFilter] = useState("");
  const actors = useMemo(() => {
    return Array.from(new Set(auditEvents.map((event: any) => String(event.actorLabel ?? "system")))).sort();
  }, [auditEvents]);

  const filteredEvents = useMemo(() => {
    return auditEvents
      .slice()
      .reverse()
      .filter((event: any) => {
        if (periodFilter && !(event.createdAt ?? "").startsWith(periodFilter)) return false;
        if (userFilter && !(event.actorLabel ?? "").toLowerCase().includes(userFilter.toLowerCase())) return false;
        if (actionFilter && event.eventType !== actionFilter) return false;
        if (objectFilter && event.entityType !== objectFilter) return false;
        if (severityFilter && auditSeverity(event) !== severityFilter) return false;
        return true;
      });
  }, [actionFilter, auditEvents, objectFilter, periodFilter, severityFilter, userFilter]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Аудит действий"
        subtitle="Журнал действий по учетной базе. Управление доступами временно скрыто: один аккаунт работает только со своим личным кабинетом."
        breadcrumbs={[{ label: "Контроль", to: "/controls" }, { label: "Аудит" }]}
      />

      <Card>
        <CardContent className="flex flex-wrap gap-2 py-4">
          <Input type="month" value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value)} className="w-44" />
          <Select value={userFilter} onChange={(event) => setUserFilter(event.target.value)} className="w-44">
            <option value="">Все пользователи</option>
            {actors.map((actor) => <option key={actor} value={actor}>{actor}</option>)}
          </Select>
          <Select value={actionFilter} onChange={(event) => setActionFilter(event.target.value)} className="w-44">
            <option value="">Все действия</option>
            {(Array.from(new Set(auditEvents.map((event: any) => String(event.eventType)))) as string[]).map((eventType) => (
              <option key={eventType} value={eventType}>{eventType}</option>
            ))}
          </Select>
          <Select value={objectFilter} onChange={(event) => setObjectFilter(event.target.value)} className="w-44">
            <option value="">Все объекты</option>
            {(Array.from(new Set(auditEvents.map((event: any) => String(event.entityType)))) as string[]).map((entityType) => (
              <option key={entityType} value={entityType}>{entityType}</option>
            ))}
          </Select>
          <Select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)} className="w-40">
            <option value="">Любая важность</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </Select>
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader>
          <div>
            <CardTitle>Журнал действий</CardTitle>
            <CardDescription>Поиск по пользователю, действию, объекту и важности. Строки только для чтения.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <THead><TR><TH>Время</TH><TH>Кто</TH><TH>Действие</TH><TH>Объект</TH><TH>Важность</TH><TH>Открыть</TH></TR></THead>
            <TBody>
              {filteredEvents.map((event: any) => (
                <TR key={event.id}>
                  <TD muted className="text-xs numeric">{dateTime(event.createdAt)}</TD>
                  <TD>{event.actorLabel ?? "system"}</TD>
                  <TD><Badge tone="neutral">{event.eventType}</Badge></TD>
                  <TD muted className="font-mono text-xs">{event.entityType} {event.entityId}</TD>
                  <TD><Badge tone={severityTone(auditSeverity(event))}>{auditSeverityLabel(auditSeverity(event))}</Badge></TD>
                  <TD>{auditObjectLink(event.entityType, event.entityId) ? <Button variant="link" size="sm" asChild><Link to={auditObjectLink(event.entityType, event.entityId)!}>Открыть объект</Link></Button> : "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function auditSeverity(event: any): "info" | "warning" | "critical" {
  if (["disable", "reopen", "close", "revoke"].includes(String(event.eventType))) return "critical";
  if (["cancel", "correct", "apply_correction", "retry"].some((code) => String(event.eventType).includes(code))) return "warning";
  return "info";
}

function severityTone(severity: "info" | "warning" | "critical"): "info" | "warning" | "danger" {
  if (severity === "critical") return "danger";
  if (severity === "warning") return "warning";
  return "info";
}

function auditSeverityLabel(severity: "info" | "warning" | "critical") {
  if (severity === "critical") return "Critical";
  if (severity === "warning") return "Warning";
  return "Info";
}

function auditObjectLink(entityType: string, entityId: string) {
  if (entityType === "document" || entityType.endsWith("_document")) return `/documents/${entityId}`;
  if (entityType === "product") return `/products/${entityId}`;
  if (entityType === "sales_channel") return `/integrations/channels/${entityId}`;
  return null;
}

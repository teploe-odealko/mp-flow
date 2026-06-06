import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, PlugZap, RotateCcw, ShieldCheck } from "lucide-react";
import { apiGet, apiPost } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { dateTime } from "@/lib/format";

interface McpKey {
  id: string;
  name: string;
  mode: "read_only" | "read_write";
  status: "active" | "revoked";
  scopes: string[];
  maskedToken?: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
}

interface McpSettings {
  endpoint: string;
  keys: McpKey[];
  instructions: Record<string, unknown>;
}

interface IssuedKey {
  endpoint: string;
  token: McpKey;
  secret: string;
  instructions: Record<string, unknown>;
}

export function McpSettingsPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("Личный агент");
  const [mode, setMode] = useState<"read_only" | "read_write">("read_only");
  const [issued, setIssued] = useState<IssuedKey | null>(null);
  const [copied, setCopied] = useState("");

  const settings = useQuery({
    queryKey: ["mcp-keys"],
    queryFn: () => apiGet<McpSettings>("/api/mcp/keys")
  });

  const createKey = useMutation({
    mutationFn: () => apiPost<IssuedKey>("/api/mcp/keys", { name, mode }),
    onSuccess: async (data) => {
      setIssued(data);
      setName("Личный агент");
      await queryClient.invalidateQueries({ queryKey: ["mcp-keys"] });
    }
  });

  const revokeKey = useMutation({
    mutationFn: (id: string) => apiPost<McpKey>(`/api/mcp/keys/${id}/revoke`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["mcp-keys"] });
    }
  });

  const endpoint = settings.data?.endpoint ?? issued?.endpoint ?? defaultEndpoint();
  const configText = useMemo(() => {
    return JSON.stringify(issued?.instructions ?? settings.data?.instructions ?? defaultInstructions(endpoint), null, 2);
  }, [endpoint, issued?.instructions, settings.data?.instructions]);

  async function copy(value: string, key: string) {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(""), 1600);
  }

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-5">
      <PageHeader
        title="MCP"
        subtitle="Ключи для подключения агентов к личному кабинету MPFlow."
        breadcrumbs={[{ label: "Настройки", to: "/settings" }, { label: "MCP" }]}
      />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-5 items-start">
        <div className="flex flex-col gap-5 min-w-0">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Сервер</CardTitle>
                <CardDescription>Streamable HTTP endpoint принимает Bearer-ключ и выполняет MCP tools.</CardDescription>
              </div>
              <PlugZap size={20} className="text-[var(--color-muted-foreground)]" />
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row gap-2">
                <Input readOnly value={endpoint} className="font-mono text-xs" />
                <Button type="button" variant="secondary" onClick={() => copy(endpoint, "endpoint")}>
                  <Copy size={14} /> {copied === "endpoint" ? "Скопировано" : "URL"}
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
                  <div className="text-xs text-[var(--color-muted-foreground)]">Транспорт</div>
                  <div className="font-medium">Streamable HTTP</div>
                </div>
                <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
                  <div className="text-xs text-[var(--color-muted-foreground)]">Авторизация</div>
                  <div className="font-medium">Authorization Bearer</div>
                </div>
                <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
                  <div className="text-xs text-[var(--color-muted-foreground)]">API</div>
                  <div className="font-medium">Через /api/*</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {issued && (
            <Card className="border-[var(--color-success)]">
              <CardHeader>
                <div>
                  <CardTitle>Новый ключ</CardTitle>
                  <CardDescription>Секрет показывается один раз. После обновления страницы останется только маска.</CardDescription>
                </div>
                <ShieldCheck size={20} className="text-[var(--color-success)]" />
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input readOnly value={issued.secret} className="font-mono text-xs" />
                  <Button type="button" onClick={() => copy(issued.secret, "secret")}>
                    <Copy size={14} /> {copied === "secret" ? "Скопировано" : "Ключ"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="min-w-0">
            <CardHeader>
              <div>
                <CardTitle>Выпущенные ключи</CardTitle>
                <CardDescription>Активный read-only ключ может читать API и отчеты. Read-write ключ выполняет POST/PATCH/DELETE через обычные валидаторы MPFlow.</CardDescription>
              </div>
              <KeyRound size={20} className="text-[var(--color-muted-foreground)]" />
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <THead>
                  <TR>
                    <TH>Название</TH>
                    <TH>Режим</TH>
                    <TH>Ключ</TH>
                    <TH>Создан</TH>
                    <TH>Последний вызов</TH>
                    <TH>Статус</TH>
                    <TH></TH>
                  </TR>
                </THead>
                <TBody>
                  {(settings.data?.keys ?? []).map((key) => (
                    <TR key={key.id}>
                      <TD className="font-medium">{key.name}</TD>
                      <TD>{modeLabel(key.mode)}</TD>
                      <TD muted className="font-mono text-xs">{key.maskedToken ?? "mpf_••••"}</TD>
                      <TD muted className="text-xs">{dateTime(key.createdAt)}</TD>
                      <TD muted className="text-xs">{key.lastUsedAt ? dateTime(key.lastUsedAt) : "—"}</TD>
                      <TD><Badge tone={key.status === "active" ? "success" : "neutral"}>{key.status === "active" ? "Активен" : "Отозван"}</Badge></TD>
                      <TD numeric>
                        {key.status === "active" && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={revokeKey.isPending}
                            onClick={() => revokeKey.mutate(key.id)}
                          >
                            <RotateCcw size={14} /> Отозвать
                          </Button>
                        )}
                      </TD>
                    </TR>
                  ))}
                  {!settings.isLoading && (settings.data?.keys ?? []).length === 0 && (
                    <TR>
                      <TD colSpan={7} muted className="text-center py-8">Ключей нет</TD>
                    </TR>
                  )}
                </TBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Выпустить ключ</CardTitle>
                <CardDescription>Для первого подключения используйте read-only.</CardDescription>
              </div>
              <KeyRound size={20} className="text-[var(--color-muted-foreground)]" />
            </CardHeader>
            <CardContent>
              <form
                className="flex flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  createKey.mutate();
                }}
              >
                <Field label="Название">
                  <Input value={name} onChange={(event) => setName(event.target.value)} required />
                </Field>
                <Field label="Режим">
                  <Select value={mode} onChange={(event) => setMode(event.target.value as "read_only" | "read_write")}>
                    <option value="read_only">Только чтение</option>
                    <option value="read_write">Чтение и запись</option>
                  </Select>
                </Field>
                <Button type="submit" disabled={createKey.isPending || !name.trim()}>
                  <KeyRound size={14} /> Выпустить
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Конфигурация</CardTitle>
                <CardDescription>JSON подходит для клиентов, которые принимают HTTP MCP servers.</CardDescription>
              </div>
              <Copy size={20} className="text-[var(--color-muted-foreground)]" />
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <pre className="max-h-[360px] overflow-auto rounded-[var(--radius-md)] bg-[var(--color-muted)] p-3 text-xs leading-relaxed">
                {configText}
              </pre>
              <Button type="button" variant="secondary" onClick={() => copy(configText, "config")}>
                <Copy size={14} /> {copied === "config" ? "Скопировано" : "Конфиг"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function modeLabel(mode: McpKey["mode"]) {
  return mode === "read_write" ? "Чтение и запись" : "Только чтение";
}

function defaultEndpoint() {
  if (typeof window === "undefined") return "/mcp";
  return `${window.location.origin}/mcp`;
}

function defaultInstructions(endpoint: string) {
  return {
    mcpServers: {
      mpflow: {
        type: "http",
        url: endpoint,
        headers: { Authorization: "Bearer <ключ из MPFlow>" }
      }
    }
  };
}

import { Badge } from "@/components/ui/badge";
import { documentStatusLabel, documentStatusTone } from "@/lib/i18n";

export function DocumentStatusBadge({ status }: { status: string }) {
  return <Badge tone={documentStatusTone[status] ?? "neutral"}>{documentStatusLabel[status] ?? status}</Badge>;
}

export function StatusBadge({
  status,
  labels,
  tone
}: {
  status: string;
  labels?: Record<string, string>;
  tone?: "neutral" | "success" | "warning" | "danger" | "info" | "primary";
}) {
  return <Badge tone={tone ?? "neutral"}>{labels?.[status] ?? status}</Badge>;
}

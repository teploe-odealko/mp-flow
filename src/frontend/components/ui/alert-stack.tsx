import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { subscribeAppAlerts, type AppAlert } from "@/lib/app-alerts";

const AUTO_DISMISS_MS = 6000;
const MAX_ALERTS = 4;

const toneStyles: Record<AppAlert["tone"], string> = {
  danger: "border-[var(--color-danger)]/30 bg-[var(--color-danger-soft)] text-[var(--color-danger)]",
  info: "border-[var(--color-info)]/30 bg-[var(--color-info-soft)] text-[var(--color-info)]",
  success: "border-[var(--color-success)]/30 bg-[var(--color-success-soft)] text-[var(--color-success)]"
};

const toneIcon: Record<AppAlert["tone"], typeof AlertTriangle> = {
  danger: AlertTriangle,
  info: Info,
  success: CheckCircle2
};

export function AlertStack() {
  const [alerts, setAlerts] = useState<AppAlert[]>([]);
  const timeoutsRef = useRef<Record<string, number>>({});

  useEffect(() => {
    return subscribeAppAlerts((alert) => {
      setAlerts((current) => [alert, ...current.filter((item) => item.message !== alert.message)].slice(0, MAX_ALERTS));
      const currentTimeout = timeoutsRef.current[alert.id];
      if (currentTimeout) window.clearTimeout(currentTimeout);
      timeoutsRef.current[alert.id] = window.setTimeout(() => {
        setAlerts((current) => current.filter((item) => item.id !== alert.id));
        delete timeoutsRef.current[alert.id];
      }, AUTO_DISMISS_MS);
    });
  }, []);

  useEffect(
    () => () => {
      Object.values(timeoutsRef.current).forEach((timeoutId) => window.clearTimeout(timeoutId));
      timeoutsRef.current = {};
    },
    []
  );

  if (alerts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[80] flex justify-center px-4 sm:justify-end">
      <div className="flex w-full max-w-md flex-col gap-2">
        {alerts.map((alert) => {
          const Icon = toneIcon[alert.tone];
          return (
            <div
              key={alert.id}
              className={cn(
                "pointer-events-auto rounded-[var(--radius-lg)] border px-4 py-3 shadow-[var(--shadow-md)] backdrop-blur",
                "bg-[var(--color-card)] text-[var(--color-foreground)]",
                toneStyles[alert.tone]
              )}
              role="alert"
              aria-live="assertive"
            >
              <div className="flex items-start gap-3">
                <Icon size={16} className="mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  {alert.title ? <div className="text-sm font-semibold">{alert.title}</div> : null}
                  <div className="text-sm leading-relaxed break-words">{alert.message}</div>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded p-1 opacity-70 transition hover:opacity-100"
                  aria-label="Закрыть уведомление"
                  onClick={() => setAlerts((current) => current.filter((item) => item.id !== alert.id))}
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

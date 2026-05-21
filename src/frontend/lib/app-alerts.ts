export type AppAlertTone = "danger" | "info" | "success";

export interface AppAlert {
  id: string;
  tone: AppAlertTone;
  title?: string;
  message: string;
}

const APP_ALERT_EVENT = "mpflow:app-alert";

function nextAlertId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `alert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function emitAppAlert(input: Omit<AppAlert, "id">) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<AppAlert>(APP_ALERT_EVENT, {
      detail: { id: nextAlertId(), ...input }
    })
  );
}

export function subscribeAppAlerts(listener: (alert: AppAlert) => void) {
  if (typeof window === "undefined") return () => undefined;
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<AppAlert>).detail;
    if (!detail?.message) return;
    listener(detail);
  };
  window.addEventListener(APP_ALERT_EVENT, handler as EventListener);
  return () => window.removeEventListener(APP_ALERT_EVENT, handler as EventListener);
}

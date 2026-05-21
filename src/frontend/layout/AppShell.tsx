import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/api";
import { AlertStack } from "@/components/ui/alert-stack";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export interface AppState {
  organization?: any;
  accountingPolicy?: any;
  periods?: any[];
  [key: string]: any;
}

const WORKING_PERIOD_KEY = "mpflow.working-period";

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [workingPeriodId, setWorkingPeriodId] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(WORKING_PERIOD_KEY) ?? "";
  });
  const stateQuery = useQuery({ queryKey: ["state"], queryFn: () => apiGet<AppState>("/api/state") });
  const state = stateQuery.data ?? {};
  const periods = state.periods ?? [];

  useEffect(() => {
    if (periods.length === 0) {
      if (workingPeriodId) {
        setWorkingPeriodId("");
      }
      return;
    }
    const stillExists = periods.some((period: any) => period.id === workingPeriodId);
    if (stillExists) return;
    const next = periods.find((period: any) => period.status === "open")?.id ?? periods[0]?.id ?? "";
    setWorkingPeriodId(next);
  }, [periods, workingPeriodId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (workingPeriodId) window.localStorage.setItem(WORKING_PERIOD_KEY, workingPeriodId);
    else window.localStorage.removeItem(WORKING_PERIOD_KEY);
  }, [workingPeriodId]);

  return (
    <div className="flex min-h-screen bg-[var(--color-background)]">
      <AlertStack />
      <a className="skip-link" href="#main-content">
        К основному содержимому
      </a>
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      <div className="flex flex-col flex-1 min-w-0">
        <Topbar state={state} />
        <main id="main-content" className="flex-1 px-7 py-6">
          {stateQuery.isLoading ? (
            <div className="text-sm text-[var(--color-muted-foreground)]">Загрузка…</div>
          ) : (
            <Outlet context={{ state, isLoading: false, workingPeriodId, setWorkingPeriodId }} />
          )}
        </main>
      </div>
    </div>
  );
}

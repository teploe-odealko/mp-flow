import { useOutletContext } from "react-router-dom";
import type { AppState } from "@/layout/AppShell";

export interface AppCtx {
  state: AppState;
  isLoading: boolean;
  workingPeriodId: string;
  setWorkingPeriodId(periodId: string): void;
}

export function useAppState() {
  return useOutletContext<AppCtx>();
}

import { useOutletContext } from "react-router-dom";

export interface AppCtx {
  isLoading: boolean;
  workingPeriodId: string;
  setWorkingPeriodId(periodId: string): void;
}

export function useAppState() {
  return useOutletContext<AppCtx>();
}

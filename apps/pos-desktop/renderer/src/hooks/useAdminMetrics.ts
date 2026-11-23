import { useCallback, useEffect, useState } from "react";
import type { AdminMetricsGetResult } from "@pos-platform/contracts";
import { callCommercial } from "../pos-service.js";

const EMPTY: AdminMetricsGetResult = {
  outcome: "AVAILABLE",
  sales_completed_count: null,
  sales_completed_amount: null,
  sales_completed_today_count: null,
  sales_completed_today_amount: null,
  inventory_tracked_count: null,
  cash_open_shift_count: null,
  payments_confirmed_count: null,
  payments_confirmed_amount: null,
  payments_confirmed_cash_amount: null,
  payments_confirmed_transfer_amount: null,
  payments_confirmed_qr_amount: null,
  payments_pending_transfer_count: null,
  metrics_scope: "INSTALLATION_BRANCH",
  metrics_period_timezone: "America/Bogota",
  metrics_business_date: "1970-01-01",
};

export function useAdminMetrics(enabled: boolean): {
  busy: boolean;
  error: string | null;
  metrics: AdminMetricsGetResult;
  refresh(): Promise<void>;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<AdminMetricsGetResult>(EMPTY);

  const refresh = useCallback(async (): Promise<void> => {
    if (!enabled) return;
    setBusy(true);
    setError(null);
    try {
      const response = await callCommercial<AdminMetricsGetResult>("admin.metrics.get", {});
      if (response.status !== "SUCCEEDED" || response.result === null) {
        setError(response.result_code);
        return;
      }
      setMetrics(response.result);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown));
    } finally {
      setBusy(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { busy, error, metrics, refresh };
}

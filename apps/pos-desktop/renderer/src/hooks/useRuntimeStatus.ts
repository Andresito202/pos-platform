import { useState, useEffect } from "react";
import { RuntimeStatusResultSchema } from "@pos-platform/contracts";
import { callCommercial } from "../pos-service.js";

export type RuntimeStatusDetails = {
  readonly outbox_pending_count: number;
  readonly outbox_dead_letter_count: number;
};

export type RuntimeStatus =
  | { phase: "loading" }
  | { phase: "connected"; details: RuntimeStatusDetails }
  | { phase: "error"; message: string };

const emptyDetails: RuntimeStatusDetails = {
  outbox_pending_count: 0,
  outbox_dead_letter_count: 0,
};

export function useRuntimeStatus(pollIntervalMs = 5_000): RuntimeStatus {
  const [status, setStatus] = useState<RuntimeStatus>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function poll(): Promise<void> {
      try {
        const result = await callCommercial("runtime.status.get", {});
        if (cancelled) return;
        if (result.status !== "SUCCEEDED") {
          setStatus({ phase: "error", message: result.result_code });
          return;
        }
        const parsed = RuntimeStatusResultSchema.safeParse(result.result);
        setStatus({
          phase: "connected",
          details: parsed.success
            ? {
                outbox_pending_count: parsed.data.outbox_pending_count,
                outbox_dead_letter_count: parsed.data.outbox_dead_letter_count,
              }
            : emptyDetails,
        });
      } catch {
        if (!cancelled) {
          setStatus({
            phase: "error",
            message: "LOCAL_SERVICE_UNAVAILABLE",
          });
        }
      }
    }

    void poll();
    const id = setInterval(() => void poll(), pollIntervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [pollIntervalMs]);

  return status;
}

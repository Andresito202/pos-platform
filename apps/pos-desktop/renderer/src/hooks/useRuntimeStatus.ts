import { useState, useEffect } from "react";
import { getPosService } from "../pos-service.js";

export type RuntimeStatus =
  | { phase: "loading" }
  | { phase: "connected"; details: unknown }
  | { phase: "error"; message: string };

export function useRuntimeStatus(pollIntervalMs = 5_000): RuntimeStatus {
  const [status, setStatus] = useState<RuntimeStatus>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function poll(): Promise<void> {
      try {
        const result = await getPosService()["runtime.status.get"]({});
        if (!cancelled) setStatus({ phase: "connected", details: result });
      } catch (error) {
        if (!cancelled) {
          setStatus({
            phase: "error",
            message: error instanceof Error ? error.message : String(error),
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

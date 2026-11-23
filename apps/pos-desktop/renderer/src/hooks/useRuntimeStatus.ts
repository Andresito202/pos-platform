import { RuntimeStatusResponseSchema } from "@pos-platform/contracts";
import { useState, useEffect } from "react";
import { getPosService, buildEnvelope } from "../pos-service.js";

/**
 * Local-service liveness for the desktop shell.
 *
 * A transport reply alone is not operational readiness. Only a contract-valid
 * `runtime.status.get` payload with `service_state === "READY"` counts as ready.
 * Connectivity, authorization (SSA/SAS) and SCM custody remain separate concerns.
 */
export type RuntimeStatus =
  | { readonly phase: "loading" }
  | { readonly phase: "ready"; readonly serviceState: "READY" }
  | {
      readonly phase: "unavailable";
      readonly reason: "UNREACHABLE" | "INVALID_RESPONSE" | "NOT_READY";
      readonly serviceState: string | null;
    };

const OPERATOR_UNAVAILABLE_MESSAGE =
  "No hay conexión operativa con el servicio local de este dispositivo.";

export function describeRuntimeUnavailable(status: Extract<RuntimeStatus, { phase: "unavailable" }>): string {
  switch (status.reason) {
    case "NOT_READY":
      return "El servicio local aún no está listo para operar.";
    case "INVALID_RESPONSE":
      return "La respuesta del servicio local no es válida.";
    case "UNREACHABLE":
    default:
      return OPERATOR_UNAVAILABLE_MESSAGE;
  }
}

export function useRuntimeStatus(pollIntervalMs = 5_000): RuntimeStatus {
  const [status, setStatus] = useState<RuntimeStatus>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function poll(): Promise<void> {
      try {
        const raw = await getPosService()["runtime.status.get"](buildEnvelope("runtime.status.get", {}));
        if (cancelled) return;
        const parsed = RuntimeStatusResponseSchema.safeParse(raw);
        if (!parsed.success || parsed.data.status !== "SUCCEEDED" || parsed.data.result === null) {
          setStatus({ phase: "unavailable", reason: "INVALID_RESPONSE", serviceState: null });
          return;
        }
        const serviceState = parsed.data.result.service_state;
        // READY is the only operational lifecycle state. STARTING/FAILED/STOPPED
        // mean the channel answered, not that the POS may treat the service as live.
        if (serviceState === "READY") {
          setStatus({ phase: "ready", serviceState: "READY" });
          return;
        }
        setStatus({ phase: "unavailable", reason: "NOT_READY", serviceState });
      } catch {
        if (!cancelled) {
          // Never surface raw transport/Node messages to the operator UI.
          setStatus({ phase: "unavailable", reason: "UNREACHABLE", serviceState: null });
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

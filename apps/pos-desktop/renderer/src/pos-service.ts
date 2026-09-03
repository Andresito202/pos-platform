export type PosServiceStatus = "idle" | "loading" | "success" | "error";

declare global {
  interface Window {
    posService: {
      "runtime.status.get"(payload: unknown): Promise<unknown>;
      "operation.result.get"(payload: { operation_id: string }): Promise<unknown>;
      "operation.confirm"(payload: { operation_id: string }): Promise<unknown>;
    };
  }
}

export function getPosService(): Window["posService"] {
  if (!("posService" in window)) {
    throw new Error("posService no disponible — el renderer debe ejecutarse dentro de Electron");
  }
  return window.posService;
}

import { useState } from "react";
import { OperationConfirmRequestSchema, OperationResultRequestSchema } from "@pos-platform/contracts";
import { buildEnvelope, getPosService } from "../pos-service.js";

export function OperationPanel(): React.JSX.Element {
  const [operationId, setOperationId] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [operationType, setOperationType] = useState("");
  const [payload, setPayload] = useState("{}");
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleGetResult(): Promise<void> {
    const id = operationId.trim();
    if (!id) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const request = OperationResultRequestSchema.parse(buildEnvelope("operation.result.get", {
        operation_id: id, idempotency_key: idempotencyKey.trim(),
      }));
      const r = await getPosService()["operation.result.get"](request);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm(): Promise<void> {
    const id = operationId.trim();
    if (!id) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const request = OperationConfirmRequestSchema.parse({
        ...buildEnvelope("operation.confirm", {
          operation_type: operationType.trim(), payload: JSON.parse(payload) as unknown,
        }, idempotencyKey.trim()),
        operation_id: id,
      });
      const r = await getPosService()["operation.confirm"](request);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="operation-panel">
      <p>Diagnóstico de operaciones. Confirmar registra una operación técnica; no cobra ni confirma una venta.</p>
      <input
        data-testid="operation-id-input"
        aria-label="ID de operación"
        type="text"
        value={operationId}
        onChange={(e) => { setOperationId(e.target.value); }}
        placeholder="ID de operación"
        disabled={busy}
      />
      <input data-testid="idempotency-key-input" aria-label="Clave de idempotencia" value={idempotencyKey}
        onChange={(e) => setIdempotencyKey(e.target.value)} disabled={busy} />
      <input data-testid="operation-type-input" aria-label="Tipo de operación" value={operationType}
        onChange={(e) => setOperationType(e.target.value)} disabled={busy} />
      <textarea data-testid="operation-payload-input" aria-label="Contenido JSON de la operación" value={payload}
        onChange={(e) => setPayload(e.target.value)} disabled={busy} />
      <button
        data-testid="get-result-button"
        onClick={() => { void handleGetResult(); }}
        disabled={busy || !operationId.trim() || !idempotencyKey.trim()}
      >
        Obtener resultado
      </button>
      <button
        data-testid="confirm-button"
        onClick={() => { void handleConfirm(); }}
        disabled={busy || !operationId.trim() || !idempotencyKey.trim() || !operationType.trim()}
      >
        Confirmar operación
      </button>
      {error !== null && <div data-testid="operation-error">{error}</div>}
      {result !== null && (
        <pre data-testid="operation-result">{JSON.stringify(result, null, 2)}</pre>
      )}
    </div>
  );
}

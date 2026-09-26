import { useState } from "react";
import { getPosService } from "../pos-service.js";

export function OperationPanel(): React.JSX.Element {
  const [operationId, setOperationId] = useState("");
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
      const r = await getPosService()["operation.result.get"]({ operation_id: id });
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
      const r = await getPosService()["operation.confirm"]({ operation_id: id });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" data-testid="operation-panel">
      <input
        data-testid="operation-id-input"
        type="text"
        value={operationId}
        onChange={(e) => { setOperationId(e.target.value); }}
        placeholder="ID de operación"
        disabled={busy}
      />
      <button
        data-testid="get-result-button"
        onClick={() => { void handleGetResult(); }}
        disabled={busy || !operationId.trim()}
      >
        Obtener resultado
      </button>
      <button
        data-testid="confirm-button"
        onClick={() => { void handleConfirm(); }}
        disabled={busy || !operationId.trim()}
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

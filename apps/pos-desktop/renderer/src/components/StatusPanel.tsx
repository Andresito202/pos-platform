import { useRuntimeStatus } from "../hooks/useRuntimeStatus.js";

export function StatusPanel(): React.JSX.Element {
  const status = useRuntimeStatus();

  if (status.phase === "loading") {
    return <div data-testid="status-loading">Conectando al servicio local…</div>;
  }
  if (status.phase === "error") {
    return <div data-testid="status-error">Sin conexión: {status.message}</div>;
  }
  return (
    <div data-testid="status-connected">
      Servicio local: conectado
    </div>
  );
}

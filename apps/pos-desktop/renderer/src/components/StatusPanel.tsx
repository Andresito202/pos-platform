import { useRuntimeStatus } from "../hooks/useRuntimeStatus.js";

export function StatusPanel(): React.JSX.Element {
  const status = useRuntimeStatus();

  if (status.phase === "loading") {
    return <div data-testid="status-loading">Conectando al servicio local…</div>;
  }
  if (status.phase === "error") {
    return <div data-testid="status-error">Sin conexión: {status.message}</div>;
  }

  const pending = status.details.outbox_pending_count;
  const dead = status.details.outbox_dead_letter_count;

  return (
    <div data-testid="status-connected">
      <span>Servicio local: conectado</span>
      {pending > 0 ? (
        <span data-testid="status-outbox-pending"> · Operaciones pendientes de sync: {pending}</span>
      ) : (
        <span data-testid="status-outbox-idle"> · Sync: al día</span>
      )}
      {dead > 0 ? (
        <span data-testid="status-outbox-dead-letter"> · Dead-letter: {dead}</span>
      ) : null}
    </div>
  );
}

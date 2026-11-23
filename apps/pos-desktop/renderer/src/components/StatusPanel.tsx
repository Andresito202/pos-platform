import { describeRuntimeUnavailable, useRuntimeStatus } from "../hooks/useRuntimeStatus.js";

type StatusPanelProps = {
  /** When set, offers a recoverable retry control for transport/lifecycle failures. */
  readonly onRetry?: () => void;
};

/**
 * Operator-facing runtime signal. Healthy READY stays silent; only recoverable
 * unavailability is shown, without raw diagnostics or secrets.
 */
export function StatusPanel({ onRetry }: StatusPanelProps = {}): React.JSX.Element | null {
  const status = useRuntimeStatus();

  if (status.phase === "loading" || status.phase === "ready") {
    return null;
  }

  return (
    <div data-testid="status-unavailable" role="status" className="pos-entry-banner pos-entry-banner--warning">
      <p>{describeRuntimeUnavailable(status)}</p>
      {onRetry !== undefined && (
        <button type="button" className="pos-entry-secondary" data-testid="status-retry" onClick={onRetry}>
          Reintentar conexión
        </button>
      )}
    </div>
  );
}

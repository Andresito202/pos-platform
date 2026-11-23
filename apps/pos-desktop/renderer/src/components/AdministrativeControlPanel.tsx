import { useAdminMetrics } from "../hooks/useAdminMetrics.js";
import { formatScale6Display } from "../money-display.js";
import {
  presentAdminMetricAmount,
  presentAdminMetricCount,
  presentAdminMetricQueryState,
  type AdminMetricPresentation,
} from "../admin-metric-display.js";
import { BusinessCashRegisterPanel } from "./BusinessCashRegisterPanel.js";

export function AdministrativeControlPanel({ browserBusiness = false }: { browserBusiness?: boolean } = {}): React.JSX.Element {
  return browserBusiness ? <BusinessCashRegisterPanel /> : <LocalAdministrativeControlPanel />;
}

function MetricCard({
  title,
  presentation,
}: {
  title: string;
  presentation: AdminMetricPresentation;
}): React.JSX.Element {
  return (
    <article className="pos-admin-card" data-metric-state={presentation.availability}>
      <span>{title}</span>
      <strong>{presentation.label}</strong>
      <small className="pos-metric-state">{presentation.detail}</small>
    </article>
  );
}

function LocalAdministrativeControlPanel(): React.JSX.Element {
  const adminMetrics = useAdminMetrics(true);
  const metrics = adminMetrics.metrics;
  const hasLoadedValue = [
    metrics.sales_completed_count,
    metrics.sales_completed_amount,
    metrics.inventory_tracked_count,
    metrics.cash_open_shift_count,
  ].some((value) => value !== null);
  const queryState = presentAdminMetricQueryState({
    busy: adminMetrics.busy,
    error: adminMetrics.error,
    hasLoadedValue,
  });

  const salesCount = presentAdminMetricCount(metrics.sales_completed_count, {
    whenNull: "unavailable",
    emptyLabel: "Sin movimientos registrados.",
  });
  const salesAmount = presentAdminMetricAmount(metrics.sales_completed_amount, formatScale6Display);
  const inventory = presentAdminMetricCount(metrics.inventory_tracked_count, {
    whenNull: "forbidden",
    emptyLabel: "Sin movimientos registrados.",
  });
  const openShifts = presentAdminMetricCount(metrics.cash_open_shift_count, {
    whenNull: "unavailable",
    emptyLabel: "Sin turnos abiertos.",
  });

  return (
    <section className="pos-admin-panel" data-testid="admin-panel-admin">
      <header className="pos-admin-header">
        <div>
          <span className="pos-admin-eyebrow">ADMINISTRACIÓN</span>
          <h2>Resumen del negocio</h2>
          <p>Consulta los indicadores disponibles para tu comercio.</p>
        </div>
        <button type="button" disabled={adminMetrics.busy} onClick={() => { void adminMetrics.refresh(); }}>
          Actualizar
        </button>
      </header>

      {queryState?.availability === "error" && (
        <div className="pos-admin-empty" role="alert" data-metric-state="error">
          <strong>{queryState.label}</strong>
          <span>{queryState.detail}</span>
        </div>
      )}
      {queryState?.availability === "loading" && (
        <div className="pos-admin-empty" role="status" data-metric-state="loading">
          <strong>{queryState.label}</strong>
          <span>{queryState.detail}</span>
        </div>
      )}

      <div className="pos-admin-grid" aria-label="Indicadores del negocio">
        <MetricCard title="Ventas completadas" presentation={salesCount} />
        <MetricCard title="Ventas acumuladas" presentation={salesAmount} />
        <MetricCard title="Productos en inventario" presentation={inventory} />
        <MetricCard title="Turnos abiertos" presentation={openShifts} />
      </div>

      <section className="pos-admin-surface pos-reporting-slots" aria-label="Indicadores próximos">
        <h3>Próximos indicadores</h3>
        <p>Estas consultas se habilitarán cuando estén disponibles para tu comercio.</p>
        <ul className="pos-reporting-slot-list">
          {[
            "Ventas del día",
            "Cobros por método de pago",
            "Efectivo esperado",
            "Inventario crítico",
            "Alertas de sucursal",
            "Utilidad estimada",
          ].map((slot) => (
            <li key={slot} data-metric-state="unavailable">
              <span>{slot}</span>
              <strong>Información no disponible</strong>
              <small>Aún no se puede consultar.</small>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}

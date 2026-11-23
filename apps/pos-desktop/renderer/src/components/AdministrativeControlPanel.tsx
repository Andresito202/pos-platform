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
  footnote,
}: {
  title: string;
  presentation: AdminMetricPresentation;
  footnote: string;
}): React.JSX.Element {
  return (
    <article className="pos-admin-card" data-metric-state={presentation.availability}>
      <span>{title}</span>
      <strong>{presentation.label}</strong>
      <small>{footnote}</small>
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
    emptyLabel: "No hay ventas completadas en el alcance; esto no es un importe inventado.",
  });
  const salesAmount = presentAdminMetricAmount(metrics.sales_completed_amount, formatScale6Display);
  const inventory = presentAdminMetricCount(metrics.inventory_tracked_count, {
    whenNull: "forbidden",
    emptyLabel: "No hay presentaciones con existencia en la sucursal.",
  });
  const openShifts = presentAdminMetricCount(metrics.cash_open_shift_count, {
    whenNull: "unavailable",
    emptyLabel: "No hay turnos OPEN/CLOSING en el alcance.",
  });

  return (
    <section className="pos-admin-panel" data-testid="admin-panel-admin">
      <header className="pos-admin-header">
        <div>
          <span className="pos-admin-eyebrow">ADMINISTRACIÓN BUSINESS LOCAL</span>
          <h2>Centro de administración</h2>
          <p>
            Indicadores del alcance autorizado de esta instalación. No concede autoridad GLOBAL
            ni acceso a Caja. Los valores nulos no se muestran como cero.
          </p>
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

      <div className="pos-admin-grid" aria-label="Métricas autorizadas">
        <MetricCard
          title="Ventas completadas"
          presentation={salesCount}
          footnote="Conteo COMPLETED vía admin.metrics.get."
        />
        <MetricCard
          title="Ventas acumuladas"
          presentation={salesAmount}
          footnote="Importe fiscal acumulado; null ≠ $0."
        />
        <MetricCard
          title="Existencias controladas"
          presentation={inventory}
          footnote="Presentaciones con fila de existencia en la sucursal."
        />
        <MetricCard
          title="Turnos abiertos"
          presentation={openShifts}
          footnote="Turnos OPEN/CLOSING del scope efectivo."
        />
      </div>

      <section className="pos-admin-surface pos-reporting-slots" aria-label="Indicadores de Reporting pendientes">
        <h3>Preparación para Reporting</h3>
        <p>
          Estructura visual compatible con futuros contratos de lectura. Sin arrays estáticos,
          sin consultas directas a tablas y sin cifras inventadas.
        </p>
        <ul className="pos-reporting-slot-list">
          {[
            "Ventas del día",
            "Cobros por método de pago",
            "Efectivo esperado",
            "Inventario crítico",
            "Alertas de sucursal",
            "Utilidad estimada (permiso financiero)",
          ].map((slot) => (
            <li key={slot} data-metric-state="unavailable">
              <span>{slot}</span>
              <strong>No disponible</strong>
              <small>Reporting no materializado (REP-001).</small>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}

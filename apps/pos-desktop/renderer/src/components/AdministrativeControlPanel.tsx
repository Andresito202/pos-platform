import { useAdminMetrics } from "../hooks/useAdminMetrics.js";
import { formatScale6Display } from "../money-display.js";

export function AdministrativeControlPanel(): React.JSX.Element {
  const adminMetrics = useAdminMetrics(true);

  return (
    <section className="pos-admin-panel" data-testid="admin-panel-admin">
      <header className="pos-admin-header">
        <h2>Centro de administración</h2>
        <button type="button" disabled={adminMetrics.busy} onClick={() => { void adminMetrics.refresh(); }}>
          Actualizar
        </button>
      </header>
        <div className="pos-admin-grid">
          <article className="pos-admin-card"><span>Ventas completadas</span><strong>{adminMetrics.metrics.sales_completed_count ?? "Sin permiso"}</strong><small>Total persistido en el scope de la sesión.</small></article>
          <article className="pos-admin-card"><span>Ventas acumuladas</span><strong>{adminMetrics.metrics.sales_completed_amount === null ? "Sin permiso" : formatScale6Display(adminMetrics.metrics.sales_completed_amount)}</strong><small>Importe total de las ventas registradas.</small></article>
          <article className="pos-admin-card"><span>Existencias controladas</span><strong>{adminMetrics.metrics.inventory_tracked_count ?? "Sin permiso"}</strong><small>Presentaciones con fila de existencia en la sucursal.</small></article>
          <article className="pos-admin-card"><span>Turnos abiertos</span><strong>{adminMetrics.metrics.cash_open_shift_count ?? "Sin permiso"}</strong><small>Turnos OPEN/CLOSING del scope efectivo.</small></article>
          {adminMetrics.error !== null && <div className="pos-admin-empty" role="alert"><strong>{adminMetrics.error}</strong><span>Las métricas no pudieron actualizarse.</span></div>}
        </div>
    </section>
  );
}

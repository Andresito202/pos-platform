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
  footnote?: string;
}): React.JSX.Element {
  return (
    <article className="pos-admin-card" data-metric-state={presentation.availability}>
      <span>{title}</span>
      <strong>{presentation.label}</strong>
      <small className="pos-metric-state">{presentation.detail}</small>
      {footnote ? <small className="pos-metric-state">{footnote}</small> : null}
    </article>
  );
}

function LocalAdministrativeControlPanel(): React.JSX.Element {
  const adminMetrics = useAdminMetrics(true);
  const metrics = adminMetrics.metrics;
  const hasLoadedValue = [
    metrics.sales_completed_count,
    metrics.sales_completed_amount,
    metrics.sales_completed_today_count,
    metrics.sales_completed_today_amount,
    metrics.inventory_tracked_count,
    metrics.cash_open_shift_count,
    metrics.payments_confirmed_count,
    metrics.payments_confirmed_amount,
  ].some((value) => value !== null);
  const queryState = presentAdminMetricQueryState({
    busy: adminMetrics.busy,
    error: adminMetrics.error,
    hasLoadedValue,
  });

  const scopeFootnote =
    "Esta instalación y sucursal autorizada · SQLite local · no es consolidado multicaja ni de empresa.";
  const inventoryFootnote =
    "Stock de sucursal en esta base local · no acredita consolidado de otras cajas.";
  const cumulativeFootnote = `Acumulado histórico · ${scopeFootnote}`;
  const todayFootnote =
    `Fecha comercial ${metrics.metrics_business_date} (${metrics.metrics_period_timezone}) · filtro por business_date · ${scopeFootnote}`;

  const salesCount = presentAdminMetricCount(metrics.sales_completed_count, {
    whenNull: "unavailable",
    emptyLabel: "Sin movimientos registrados.",
  });
  const salesAmount = presentAdminMetricAmount(metrics.sales_completed_amount, formatScale6Display);
  const salesTodayCount = presentAdminMetricCount(metrics.sales_completed_today_count, {
    whenNull: "unavailable",
    emptyLabel: "Sin movimientos registrados.",
  });
  const salesTodayAmount = presentAdminMetricAmount(metrics.sales_completed_today_amount, formatScale6Display);
  const inventory = presentAdminMetricCount(metrics.inventory_tracked_count, {
    whenNull: "forbidden",
    emptyLabel: "Sin movimientos registrados.",
  });
  const openShifts = presentAdminMetricCount(metrics.cash_open_shift_count, {
    whenNull: "unavailable",
    emptyLabel: "Sin turnos abiertos.",
  });
  const paymentsConfirmedCount = presentAdminMetricCount(metrics.payments_confirmed_count, {
    whenNull: "unavailable",
    emptyLabel: "Sin pagos confirmados.",
  });
  const paymentsConfirmedAmount = presentAdminMetricAmount(metrics.payments_confirmed_amount, formatScale6Display);
  const paymentsCash = presentAdminMetricAmount(metrics.payments_confirmed_cash_amount, formatScale6Display);
  const paymentsTransfer = presentAdminMetricAmount(metrics.payments_confirmed_transfer_amount, formatScale6Display);
  const paymentsQr = presentAdminMetricAmount(metrics.payments_confirmed_qr_amount, formatScale6Display);
  const pendingTransfers = presentAdminMetricCount(metrics.payments_pending_transfer_count, {
    whenNull: "unavailable",
    emptyLabel: "Sin transferencias pendientes.",
  });

  return (
    <section className="pos-admin-panel" data-testid="admin-panel-admin">
      <header className="pos-admin-header">
        <div>
          <span className="pos-admin-eyebrow">ADMINISTRACIÓN</span>
          <h2>Resumen del negocio</h2>
          <p>
            Indicadores de esta instalación y sucursal autorizada. El importe vendido y el
            recaudo confirmado son lecturas distintas y no se suman.
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

      <div className="pos-admin-grid" aria-label="Ventas e inventario">
        <MetricCard title="Ventas completadas" presentation={salesCount} footnote={cumulativeFootnote} />
        <MetricCard title="Importe vendido" presentation={salesAmount} footnote={cumulativeFootnote} />
        <MetricCard title="Ventas de hoy" presentation={salesTodayCount} footnote={todayFootnote} />
        <MetricCard title="Importe de hoy" presentation={salesTodayAmount} footnote={todayFootnote} />
        <MetricCard title="Productos en inventario" presentation={inventory} footnote={inventoryFootnote} />
        <MetricCard title="Turnos abiertos" presentation={openShifts} footnote={scopeFootnote} />
      </div>

      <div className="pos-admin-grid" aria-label="Pagos confirmados">
        <MetricCard title="Pagos confirmados" presentation={paymentsConfirmedCount} footnote={cumulativeFootnote} />
        <MetricCard title="Recaudo confirmado" presentation={paymentsConfirmedAmount} footnote={cumulativeFootnote} />
        <MetricCard title="Recaudo en efectivo" presentation={paymentsCash} footnote={cumulativeFootnote} />
        <MetricCard title="Recaudo por transferencia" presentation={paymentsTransfer} footnote={cumulativeFootnote} />
        <MetricCard title="Recaudo por QR" presentation={paymentsQr} footnote={cumulativeFootnote} />
        <MetricCard
          title="Transferencias pendientes"
          presentation={pendingTransfers}
          footnote={`No es dinero recibido · ${scopeFootnote}`}
        />
      </div>

      <section className="pos-admin-surface pos-reporting-slots" aria-label="Indicadores próximos">
        <h3>Próximos indicadores</h3>
        <p>Estas consultas requieren consolidación o permisos adicionales aún no disponibles.</p>
        <ul className="pos-reporting-slot-list">
          {[
            "Efectivo esperado",
            "Inventario crítico",
            "Alertas de sucursal",
            "Utilidad estimada",
            "Consolidado multicaja / empresa",
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

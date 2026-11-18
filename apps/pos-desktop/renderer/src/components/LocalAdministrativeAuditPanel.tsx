/**
 * Local SUPERADMINISTRADOR / AUDIT_EVENT_READ surface recovered for NSIS live auth.
 * Intentionally excludes commercial admin.metrics, platform licensing, and FACTUS.
 */
export function LocalAdministrativeAuditPanel(): React.JSX.Element {
  return (
    <section className="pos-admin-panel" data-testid="admin-panel-audit">
      <header className="pos-admin-header">
        <div>
          <span className="pos-admin-eyebrow">CONTROL</span>
          <h2>Auditoría administrativa</h2>
          <p>Trazabilidad de acciones administrativas y de plataforma.</p>
        </div>
        <span className="pos-scope-chip">
          Los eventos deben proceder del registro de auditoría real; no se muestran datos simulados.
        </span>
      </header>
      <div className="pos-admin-grid" aria-label="Resumen de auditoría">
        {[
          { label: "Eventos", detail: "Consulta al registro de auditoría pendiente" },
          { label: "Críticos", detail: "Consulta al registro de auditoría pendiente" },
          { label: "Denegados", detail: "Consulta al registro de auditoría pendiente" },
          { label: "Última actividad", detail: "Consulta al registro de auditoría pendiente" },
        ].map((card) => (
          <article key={card.label} className="pos-admin-card">
            <span>{card.label}</span>
            <strong>—</strong>
            <small>{card.detail}</small>
          </article>
        ))}
      </div>
      <div className="pos-admin-empty" role="status">
        <span>Sin eventos cargados en esta superficie local.</span>
        <span>La lectura append-only del registro de auditoría no inventa filas.</span>
      </div>
    </section>
  );
}

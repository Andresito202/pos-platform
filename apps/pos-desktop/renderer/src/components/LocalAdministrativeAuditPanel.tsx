/**
 * Local SUPERADMINISTRADOR / AUDIT_EVENT_READ surface recovered for NSIS live auth.
 * Intentionally excludes commercial admin.metrics, platform licensing, and FACTUS.
 * Local SUPERADMINISTRADOR ≠ GLOBAL PLATFORM_OWNER ≠ ADMINISTRADOR BUSINESS.
 */
export function LocalAdministrativeAuditPanel(): React.JSX.Element {
  return (
    <section className="pos-admin-panel" data-testid="admin-panel-audit">
      <header className="pos-admin-header">
        <div>
          <span className="pos-admin-eyebrow">AUDITORÍA</span>
          <h2>Auditoría administrativa</h2>
          <p>Consulta de acciones administrativas en este dispositivo.</p>
        </div>
        <span className="pos-scope-chip">
          Superadministrador local · sin acceso a la administración de la plataforma
        </span>
      </header>

      <div className="pos-admin-security-list" aria-label="Ámbitos de acceso">
        <span>Administrador del negocio: resumen e indicadores del comercio.</span>
        <span>Superadministrador local: auditoría en este dispositivo.</span>
        <span>Administración de la plataforma: empresas, licencias y operación central en sus módulos propios.</span>
      </div>

      <section className="pos-admin-surface" aria-label="Registro de auditoría">
        <h3>Registro de auditoría</h3>
        <div className="pos-admin-empty" role="status" data-metric-state="unavailable">
          <strong>Información no disponible</strong>
          <span>Aún no se pueden consultar eventos de auditoría en esta pantalla.</span>
        </div>
      </section>

      <section className="pos-admin-surface pos-reporting-slots" aria-label="Indicadores de plataforma">
        <h3>Indicadores de plataforma</h3>
        <p>Estos indicadores pertenecen a la administración de la plataforma y no se muestran aquí.</p>
        <ul className="pos-reporting-slot-list">
          {[
            "Empresas y licencias",
            "Planes y suscripciones",
            "Dispositivos activados",
            "Estado técnico y sincronización",
            "Incidentes y auditoría autorizada",
          ].map((slot) => (
            <li key={slot} data-metric-state="unavailable">
              <span>{slot}</span>
              <strong>Información no disponible</strong>
              <small>Fuera del alcance de esta pantalla.</small>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}

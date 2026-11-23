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
          <span className="pos-admin-eyebrow">AUDITORÍA LOCAL</span>
          <h2>Auditoría administrativa</h2>
          <p>
            Superficie de lectura para el perfil local de auditoría. No es el portal GLOBAL
            de la plataforma y no concede ventas, pagos ni datos privados de comercios.
          </p>
        </div>
        <span className="pos-scope-chip">
          Autoridad local de desarrollo · distinta de GLOBAL y de ADMINISTRADOR BUSINESS
        </span>
      </header>

      <div className="pos-admin-security-list" aria-label="Límites de autoridad">
        <span>Superadministrador local: auditoría autorizada en este dispositivo.</span>
        <span>GLOBAL: licencias, empresas y operación Central — módulos propios, no este panel.</span>
        <span>Administrador BUSINESS: métricas y cajas del comercio — Dashboard local / portal BUSINESS.</span>
        <span>Esta pantalla no mezcla autoridades ni inventa eventos de auditoría.</span>
      </div>

      <section className="pos-admin-surface" aria-label="Registro de auditoría">
        <h3>Registro append-only</h3>
        <p>
          El contrato <code>audit.event.list</code> existe en packages/contracts, pero no está
          cableado aún en el IPC del desktop ni en el servicio local de esta línea. Sin cableado
          no se listan filas.
        </p>
        <div className="pos-admin-empty" role="status" data-metric-state="unavailable">
          <strong>No disponible</strong>
          <span>Sin eventos cargados: la consulta al registro real no está materializada en este runtime.</span>
          <span>No se muestran datos simulados ni resúmenes inventados.</span>
        </div>
      </section>

      <section className="pos-admin-surface pos-reporting-slots" aria-label="Indicadores GLOBAL pendientes">
        <h3>Preparación para Reporting GLOBAL</h3>
        <p>
          Estructura visual para indicadores de plataforma. No otorga acceso automático a
          ventas, pagos o información privada de negocios.
        </p>
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
              <strong>No disponible</strong>
              <small>Reporting GLOBAL no materializado · fuera de este panel local.</small>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}

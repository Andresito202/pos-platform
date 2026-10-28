import { useState } from "react";
import { useAdministrativeAudit } from "../hooks/useAdministrativeAudit.js";
import { useAdminMetrics } from "../hooks/useAdminMetrics.js";
import type {PlatformClient,PublishedOffer} from "../platform-client.js";
import {PlatformOfferEditor} from "./PlatformOfferEditor.js";

type ControlKind = "admin" | "superadmin" | "audit";

type Tab = "overview" | "monitoring" | "security";

const tabLabels: Record<Tab, string> = {
  overview: "Resumen",
  monitoring: "Seguimiento",
  security: "Seguridad",
};

const copy: Record<ControlKind, {
  title: string;
  subtitle: string;
  scope: string;
  cards: readonly { label: string; value: string; detail: string }[];
}> = {
  admin: {
    title: "Centro de administración",
    subtitle: "Seguimiento operativo de empresa, sucursales, usuarios y dispositivos.",
    scope: "Alcance: tenant y scope efectivo de la sesión",
    cards: [
      { label: "Ventas", value: "—", detail: "Dato pendiente de consulta al servicio" },
      { label: "Inventario", value: "—", detail: "Dato pendiente de consulta al servicio" },
      { label: "Caja", value: "—", detail: "Dato pendiente de consulta al servicio" },
      { label: "Alertas", value: "—", detail: "Dato pendiente de consulta al servicio" },
    ],
  },
  superadmin: {
    title: "Superadministrador",
    subtitle: "Control de plataforma, licencias, planes, cuentas y seguridad.",
    scope: "Alcance: plataforma · las acciones críticas exigen autorización backend",
    cards: [
      { label: "Licencias", value: "—", detail: "Sin lectura ejecutable materializada aún" },
      { label: "Cuentas", value: "—", detail: "Sin lectura ejecutable materializada aún" },
      { label: "Planes", value: "—", detail: "Sin lectura ejecutable materializada aún" },
      { label: "Riesgo", value: "—", detail: "Sin métrica ejecutable materializada aún" },
    ],
  },
  audit: {
    title: "Auditoría administrativa",
    subtitle: "Trazabilidad de acciones administrativas y de plataforma.",
    scope: "Los eventos deben proceder del registro de auditoría real; no se muestran datos simulados.",
    cards: [
      { label: "Eventos", value: "—", detail: "Consulta al registro de auditoría pendiente" },
      { label: "Críticos", value: "—", detail: "Consulta al registro de auditoría pendiente" },
      { label: "Denegados", value: "—", detail: "Consulta al registro de auditoría pendiente" },
      { label: "Última actividad", value: "—", detail: "Consulta al registro de auditoría pendiente" },
    ],
  },
};

export function AdministrativeControlPanel({ kind,platform }: { kind: ControlKind;platform?:{client:PlatformClient;offers:PublishedOffer[];onChanged:()=>Promise<void>} }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>("overview");
  const model = copy[kind];
  const audit = useAdministrativeAudit(kind === "audit");
  const adminMetrics = useAdminMetrics(kind === "admin");

  return (
    <section className="pos-admin-panel" data-testid={`admin-panel-${kind}`}>
      <header className="pos-admin-header">
        <div>
          <span className="pos-admin-eyebrow">{kind === "superadmin" ? "PLATAFORMA" : "CONTROL"}</span>
          <h2>{model.title}</h2>
          <p>{model.subtitle}</p>
        </div>
        <span className="pos-scope-chip">{model.scope}</span>
      </header>

      <nav className="pos-admin-tabs" aria-label={`Navegación de ${model.title}`}>
        {(Object.keys(tabLabels) as Tab[]).map((item) => (
          <button
            key={item}
            type="button"
            aria-current={tab === item ? "page" : undefined}
            onClick={() => setTab(item)}
          >
            {tabLabels[item]}
          </button>
        ))}
      </nav>

      {tab === "overview" && kind === "admin" && (
        <div className="pos-admin-grid">
          <article className="pos-admin-card"><span>Ventas completadas</span><strong>{adminMetrics.metrics.sales_completed_count ?? "Sin permiso"}</strong><small>Total persistido en el scope de la sesión.</small></article>
          <article className="pos-admin-card"><span>Ventas acumuladas</span><strong>{adminMetrics.metrics.sales_completed_amount ?? "Sin permiso"}</strong><small>Importe fiscal total persistido, escala 6.</small></article>
          <article className="pos-admin-card"><span>Existencias controladas</span><strong>{adminMetrics.metrics.inventory_tracked_count ?? "Sin permiso"}</strong><small>Presentaciones con fila de existencia en la sucursal.</small></article>
          <article className="pos-admin-card"><span>Turnos abiertos</span><strong>{adminMetrics.metrics.cash_open_shift_count ?? "Sin permiso"}</strong><small>Turnos OPEN/CLOSING del scope efectivo.</small></article>
          {adminMetrics.error !== null && <div className="pos-admin-empty" role="alert"><strong>{adminMetrics.error}</strong><span>Las métricas no pudieron actualizarse.</span></div>}
        </div>
      )}

      {tab === "overview" && kind === "superadmin" && (
        <div className="pos-admin-grid">
          {model.cards.map((card) => (
            <article key={card.label} className="pos-admin-card">
              <span>{card.label}</span><strong>{card.label==="Planes"&&platform?platform.offers.filter(o=>o.status==="ACTIVE").length:card.value}</strong><small>{card.label==="Planes"&&platform?"Versiones publicadas verificadas en Central":card.detail}</small>
            </article>
          ))}
        </div>
      )}

      {tab === "overview" && kind === "audit" && (
        <div className="pos-admin-grid">
          <article className="pos-admin-card"><span>Eventos cargados</span><strong>{audit.totalLoaded}</strong><small>Filas reales de auditoría dentro del scope efectivo.</small></article>
          <article className="pos-admin-card"><span>Última actividad</span><strong>{audit.events[0]?.created_at ? new Date(audit.events[0].created_at).toLocaleString() : "—"}</strong><small>Ordenada por secuencia descendente.</small></article>
          <article className="pos-admin-card"><span>Scope</span><strong>Sesión</strong><small>Tenant, empresa y sucursal los resuelve el servicio.</small></article>
          <article className="pos-admin-card"><span>Paginación</span><strong>{audit.hasMore ? "Disponible" : "Completa"}</strong><small>El renderer no calcula páginas fuera del contrato.</small></article>
        </div>
      )}

      {tab === "monitoring" && kind === "admin" ? (
        <div className="pos-admin-surface">
          <h3>Seguimiento operativo</h3>
          <p>Las métricas proceden del servicio local y respetan el scope y los permisos efectivos de la sesión.</p>
          <div className="pos-admin-grid">
            <article className="pos-admin-card"><span>Ventas</span><strong>{adminMetrics.metrics.sales_completed_count ?? "Sin permiso"}</strong><small>{adminMetrics.metrics.sales_completed_amount ?? "Importe no autorizado"}</small></article>
            <article className="pos-admin-card"><span>Inventario</span><strong>{adminMetrics.metrics.inventory_tracked_count ?? "Sin permiso"}</strong><small>Existencias controladas en el scope.</small></article>
            <article className="pos-admin-card"><span>Caja</span><strong>{adminMetrics.metrics.cash_open_shift_count ?? "Sin permiso"}</strong><small>Turnos OPEN/CLOSING en el scope.</small></article>
          </div>
          <button type="button" onClick={() => void adminMetrics.refresh()} disabled={adminMetrics.busy}>
            {adminMetrics.busy ? "Actualizando…" : "Actualizar métricas"}
          </button>
          {adminMetrics.error !== null && <div className="pos-admin-empty" role="alert"><strong>{adminMetrics.error}</strong><span>Las métricas no pudieron actualizarse.</span></div>}
        </div>
      ) : tab === "monitoring" && kind === "audit" ? (
        <div className="pos-admin-surface">
          <h3>Seguimiento de evidencia</h3>
          <p>Consulta read-only de la auditoría local append-only. No se exponen detalles JSON sensibles en esta vista.</p>
          <div className="pos-admin-audit-toolbar">
            <input aria-label="Buscar auditoría" placeholder="Acción, recurso o motivo" value={audit.filters.query} onChange={(event) => audit.setFilters({ ...audit.filters, query: event.target.value })} />
            <input aria-label="Código de acción" placeholder="Código de acción" value={audit.filters.actionCode} onChange={(event) => audit.setFilters({ ...audit.filters, actionCode: event.target.value })} />
            <input aria-label="Tipo de recurso" placeholder="Tipo de recurso" value={audit.filters.resourceType} onChange={(event) => audit.setFilters({ ...audit.filters, resourceType: event.target.value })} />
            <select aria-label="Tipo de actor" value={audit.filters.actorType} onChange={(event) => audit.setFilters({ ...audit.filters, actorType: event.target.value as typeof audit.filters.actorType })}>
              <option value="">Todos los actores</option><option value="USER">Usuario</option><option value="DEVICE">Dispositivo</option><option value="SYSTEM">Sistema</option>
            </select>
            <label>Desde <input aria-label="Fecha desde" type="datetime-local" value={audit.filters.from} onChange={(event) => audit.setFilters({ ...audit.filters, from: event.target.value })} /></label>
            <label>Hasta <input aria-label="Fecha hasta" type="datetime-local" value={audit.filters.to} onChange={(event) => audit.setFilters({ ...audit.filters, to: event.target.value })} /></label>
            <button type="button" onClick={() => void audit.refresh()} disabled={audit.busy}>Actualizar</button>
          </div>
          {audit.error !== null && <div className="pos-admin-empty" role="alert"><strong>{audit.error}</strong><span>La consulta fue rechazada o no pudo completarse.</span></div>}
          <div className="pos-table-scroll" tabIndex={0} role="region" aria-label="Eventos de auditoría, tabla desplazable">
          <table className="pos-data-table" aria-label="Eventos de auditoría">
            <caption>Eventos dentro del alcance de la sesión</caption>
            <thead><tr><th scope="col">Sec.</th><th scope="col">Fecha</th><th scope="col">Actor</th><th scope="col">Acción</th><th scope="col">Recurso</th><th scope="col">Motivo</th></tr></thead>
            <tbody>
            {audit.events.map((event) => (
              <tr key={event.sequence}>
                <td className="pos-number">{event.sequence}</td><td>{new Date(event.created_at).toLocaleString()}</td><td>{event.actor_type}</td><td>{event.action_code}</td><td>{event.resource_type}</td><td>{event.reason_code ?? "—"}</td>
              </tr>
            ))}
            </tbody>
          </table>
          </div>
          <div className="pos-admin-audit-actions"><span>{audit.busy ? "Consultando…" : `${audit.totalLoaded} ${audit.totalLoaded === 1 ? "evento cargado" : "eventos cargados"}`}</span><button type="button" onClick={() => void audit.nextPage()} disabled={!audit.hasMore || audit.busy}>Cargar más</button></div>
        </div>
      ) : tab === "monitoring" ? (
        <div className="pos-admin-surface">
          <h3>Seguimiento</h3><p>La superficie está preparada para consumir métricas y estados del servicio sin inventar cifras en el renderer.</p>
          <div className="pos-admin-empty" role="status"><strong>Sin datos ejecutables</strong><span>El contrato de lectura correspondiente debe materializarse antes de mostrar métricas reales.</span></div>
        </div>
      ) : null}

      {kind==="superadmin"&&platform&&tab==="overview"&&<PlatformOfferEditor client={platform.client} offers={platform.offers} onChanged={platform.onChanged}/>}
      {tab === "security" && (
        <div className="pos-admin-surface">
          <h3>Seguridad y trazabilidad</h3>
          <p>Las acciones sensibles se mantienen separadas de la presentación. El frontend no concede permisos ni fabrica eventos.</p>
          <div className="pos-admin-security-list">
            <span>Autorización efectiva</span>
            <span>Scope tenant / company / branch</span>
            <span>Sesión y dispositivo</span>
            <span>Auditoría append-only</span>
          </div>
        </div>
      )}
    </section>
  );
}

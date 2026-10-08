import { useState } from "react";

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

export function AdministrativeControlPanel({ kind }: { kind: ControlKind }): React.JSX.Element {
  const [tab, setTab] = useState<Tab>("overview");
  const model = copy[kind];

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

      {tab === "overview" && (
        <div className="pos-admin-grid">
          {model.cards.map((card) => (
            <article key={card.label} className="pos-admin-card">
              <span>{card.label}</span>
              <strong>{card.value}</strong>
              <small>{card.detail}</small>
            </article>
          ))}
        </div>
      )}

      {tab === "monitoring" && (
        <div className="pos-admin-surface">
          <h3>Seguimiento</h3>
          <p>La superficie está preparada para consumir métricas y estados del servicio sin inventar cifras en el renderer.</p>
          <div className="pos-admin-empty" role="status">
            <strong>Sin datos ejecutables</strong>
            <span>El contrato de lectura correspondiente debe materializarse antes de mostrar métricas reales.</span>
          </div>
        </div>
      )}

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

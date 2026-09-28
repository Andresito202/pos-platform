import { useState } from "react";
import { SessionPanel } from "./components/SessionPanel.js";
import { StatusPanel } from "./components/StatusPanel.js";
import { OperationPanel } from "./components/OperationPanel.js";
import { SalePanel } from "./components/SalePanel.js";
import { ProviderPaymentPanel } from "./components/ProviderPaymentPanel.js";
import { ReceiptPanel } from "./components/ReceiptPanel.js";
import { ReturnPanel } from "./components/ReturnPanel.js";
import { CatalogPanel } from "./components/CatalogPanel.js";
import { CatalogImportPanel } from "./components/CatalogImportPanel.js";
import { InventoryPanel } from "./components/InventoryPanel.js";
import { LotPanel } from "./components/LotPanel.js";
import { CustomerPanel } from "./components/CustomerPanel.js";
import { CreditPanel } from "./components/CreditPanel.js";
import { FiscalPanel } from "./components/FiscalPanel.js";
import { LoginScreen } from "./components/LoginScreen.js";
import { useOperatorAuth, type OperatorAuth } from "./hooks/useOperatorAuth.js";

/**
 * El orden sigue el de la jornada real, no el de la arquitectura: primero se
 * carga el catálogo —la carga masiva va antes que el alta de uno en uno,
 * porque es como se estrena un comercio— y entra la mercancía —la que trae
 * lote, con su tanda y su vencimiento—, después se vende y se cobra, luego se
 * entrega el recibo. El adquiriente vive al lado porque se registra cuando el
 * cliente lo pide, no en un momento fijo.
 *
 * La sesión va antes que todo, incluido el estado del servicio: sin vínculo de
 * sesión cada operación de abajo se rechaza con `SESSION_NOT_BOUND`, y ésa es
 * la primera pregunta que hay que poder responder al abrir el equipo.
 *
 * El QR va junto a la venta porque cobra una venta, pero después del efectivo
 * y la transferencia: es el medio que **no** se resuelve en el mostrador, y su
 * desenlace llega más tarde y por otra vía.
 *
 * El fiado va **después** del adquiriente porque lo presupone: `DEC-002` §159
 * exige que la venta nombre un adquiriente para poder fiarla, así que sin
 * cliente registrado no hay cuenta de crédito que abrir.
 *
 * La emisión fiscal va la última de la jornada porque necesita las dos cosas
 * que la preceden: la venta cobrada y el adquiriente (`DEC-021` F5).
 *
 * ## Navegación lateral (2026-09-28) — sólo presentación
 *
 * El mismo orden se reparte ahora en secciones con un menú lateral, en vez de
 * una sola página de 13 tarjetas. **No cambia lógica**: cada panel es el mismo
 * componente, con sus mismos hooks y `data-testid`. Las secciones que no se
 * ven siguen **montadas** —sólo llevan `hidden`—: cambiar de sección no
 * desmonta un panel, así que una venta a medio cobrar, un formulario escrito o
 * una consulta en curso siguen ahí al volver, y ningún panel repite al volver
 * la consulta que hace al montar.
 */
interface NavSection {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly panels: () => React.JSX.Element;
}

/** El orden de la jornada (arriba), agrupado por lo que el operador va a hacer. */
const SECTIONS: readonly NavSection[] = [
  {
    id: "inicio",
    label: "Inicio",
    hint: "Sesión del equipo",
    panels: () => <SessionPanel />,
  },
  {
    id: "vender",
    label: "Vender",
    hint: "Venta, cobro y recibo",
    panels: () => (
      <>
        <SalePanel />
        <ProviderPaymentPanel />
        <ReceiptPanel />
      </>
    ),
  },
  {
    id: "devoluciones",
    label: "Devoluciones",
    hint: "Devolver y reembolsar",
    panels: () => <ReturnPanel />,
  },
  {
    id: "catalogo",
    label: "Catálogo",
    hint: "Carga inicial y artículos",
    panels: () => (
      <>
        <CatalogImportPanel />
        <CatalogPanel />
      </>
    ),
  },
  {
    id: "inventario",
    label: "Inventario",
    hint: "Existencias y lotes",
    panels: () => (
      <>
        <InventoryPanel />
        <LotPanel />
      </>
    ),
  },
  {
    id: "clientes",
    label: "Clientes y fiado",
    hint: "Adquirientes y crédito",
    panels: () => (
      <>
        <CustomerPanel />
        <CreditPanel />
      </>
    ),
  },
  {
    id: "facturacion",
    label: "Facturación",
    hint: "Documento electrónico",
    panels: () => <FiscalPanel />,
  },
  {
    id: "operaciones",
    label: "Operaciones",
    hint: "Resultado y confirmación",
    panels: () => <OperationPanel />,
  },
];

/**
 * ¿Exige este equipo iniciar sesión antes de mostrar el POS? Lo decide el
 * proceso principal al cargar la ventana (`?login=required`), según la
 * configuración del equipo: sólo un equipo con autoridad central de login
 * puede pedirlo, porque sólo ahí hay con qué iniciar sesión (`DEC-026` §13.11).
 * Sin él, la ventana se comporta como antes: la sesión llega por
 * `session.activate`/`session.recover`.
 */
export function loginRequired(search: string = globalThis.location?.search ?? ""): boolean {
  return new URLSearchParams(search).get("login") === "required";
}

export function App(): React.JSX.Element {
  return loginRequired() ? <AuthenticatedApp /> : <PosShell auth={null} />;
}

/** Puerta de login: el POS sólo se monta con una sesión que el servicio confirmó. */
function AuthenticatedApp(): React.JSX.Element {
  const auth = useOperatorAuth();
  if (auth.phase !== "SIGNED_IN") return <LoginScreen auth={auth} />;
  return <PosShell auth={auth} />;
}

function PosShell({ auth }: { readonly auth: OperatorAuth | null }): React.JSX.Element {
  const [active, setActive] = useState<string>(SECTIONS[0]!.id);
  const current = SECTIONS.find((section) => section.id === active) ?? SECTIONS[0]!;

  return (
    <div className="app-shell">
      <aside className="app-sidebar" data-testid="app-sidebar">
        <header className="app-bar">
          <span className="app-mark" aria-hidden="true">CP</span>
          <h1>POS Local</h1>
        </header>
        <nav className="app-nav" aria-label="Secciones">
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              className="app-nav-item"
              data-nav-target={section.id}
              aria-current={section.id === active ? "page" : undefined}
              onClick={() => setActive(section.id)}
            >
              <span className="app-nav-label">{section.label}</span>
              <span className="app-nav-hint">{section.hint}</span>
            </button>
          ))}
        </nav>
        <div className="app-sidebar-footer">
          {auth !== null && auth.session !== null && (
            <div className="app-operator" data-testid="operator-session">
              <span className="app-operator-label">Sesión activa</span>
              <span className="app-operator-until">
                hasta {new Date(auth.session.offlineValidUntil).toLocaleString()}
              </span>
              <button
                type="button"
                className="app-logout"
                data-testid="logout-button"
                disabled={auth.busy}
                onClick={() => { void auth.logout(); }}
              >
                Salir
              </button>
            </div>
          )}
          <StatusPanel />
        </div>
      </aside>
      <main className="app-main">
        <header className="app-section-bar">
          <h2 data-testid="app-section-title">{current.label}</h2>
          <span className="app-section-hint">{current.hint}</span>
        </header>
        {SECTIONS.map((section) => (
          <div
            key={section.id}
            className="app-content"
            data-nav-section={section.id}
            hidden={section.id !== active}
          >
            {section.panels()}
          </div>
        ))}
      </main>
    </div>
  );
}

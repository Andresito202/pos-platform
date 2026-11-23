import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";
import "./commercial-precision.css";
import "./workspace.css";
import { BrandMark } from "./components/BrandMark.js";
import { OperationPanel } from "./components/OperationPanel.js";
import { StatusPanel } from "./components/StatusPanel.js";
import { LocalOperatorLoginPanel } from "./components/LocalOperatorLoginPanel.js";
import { LocalOperatorSessionControl } from "./components/LocalOperatorSessionControl.js";
import { LocalAdministrativeAuditPanel } from "./components/LocalAdministrativeAuditPanel.js";
import { InstitutionalWebsiteLink } from "./components/InstitutionalWebsiteLink.js";

import { AdministrativeControlPanel } from "./components/AdministrativeControlPanel.js";
import { TransferReviewPanel } from "./components/TransferReviewPanel.js";
import { SalePanel } from "./components/SalePanel.js";
import { ReceiptPanel } from "./components/ReceiptPanel.js";
import { HardwarePanel } from "./components/HardwarePanel.js";
import { CatalogPanel } from "./components/CatalogPanel.js";
import { InventoryPanel } from "./components/InventoryPanel.js";
import { CustomerPanel } from "./components/CustomerPanel.js";
import { FiscalPanel } from "./components/FiscalPanel.js";
import { useAuthorizationCapabilities } from "./hooks/useAuthorizationCapabilities.js";
import { useLocalOperatorSession } from "./hooks/useLocalOperatorSession.js";
import { homeScreenId, orderScreensByRole } from "./roleNavigation.js";

function hasAny(permissions: ReadonlySet<string>, required: readonly string[]): boolean {
  return required.some((permission) => permissions.has(permission));
}

type Screen = {
  id: string;
  label: string;
  render: () => React.JSX.Element;
};

export function App(): React.JSX.Element {
  if (window.location.protocol === "https:" && window.location.pathname.startsWith("/business/")) {
    return <main className="pos-main"><BrandMark variant="header" /><AdministrativeControlPanel browserBusiness /></main>;
  }
  return <LocalApp />;
}
function LocalApp(): React.JSX.Element {
  const authorization = useAuthorizationCapabilities();
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const [navigationOpen, setNavigationOpen] = useState(true);
  const localSession = useLocalOperatorSession(sessionEpoch);
  const [activeScreen, setActiveScreen] = useState<string | null>(null);
  // Tip #106: keep visited screens mounted (hidden) so SalePanel shift/cart
  // state survives capability navigation. Unmounting on every nav wiped the open shift.
  const [visitedScreens, setVisitedScreens] = useState<ReadonlySet<string>>(new Set());

  const refreshAccess = useCallback((): void => {
    setSessionEpoch((value) => value + 1);
    authorization.retry();
  }, [authorization.retry]);

  const navigateTo = useCallback((id: string, from: string | null): void => {
    setVisitedScreens((visited) => new Set([...visited, ...(from === null ? [] : [from]), id]));
    setActiveScreen(id);
  }, []);

  useEffect(() => {
    // Only clear workspace navigation when the session leaves the authorized
    // surface. Background revalidation must not wipe an active screen.
    if (
      authorization.phase === "unauthenticated"
      || authorization.phase === "denied"
      || authorization.phase === "expired"
      || authorization.phase === "error"
    ) {
      setActiveScreen(null);
      setVisitedScreens(new Set());
      setNavigationOpen(true);
    }
  }, [authorization.phase]);

  // Reset workspace only when a settled local identity *changes* (login, role
  // switch, logout). Epoch bumps during an already-authorized session must not
  // bounce navigation back to the role home.
  const settledIdentity = localSession.ready
    ? `${localSession.username ?? ""}:${localSession.role ?? ""}`
    : null;
  useEffect(() => {
    if (settledIdentity === null) return;
    setActiveScreen(null);
    setVisitedScreens(new Set());
  }, [settledIdentity]);

  const screens = useMemo<Screen[]>(() => {
    if (authorization.phase !== "ready" || !localSession.ready) return [];

    const { permissions, entitlements } = authorization;
    const result: Screen[] = [];

    if (permissions.has("SALES_SALE_CREATE")) {
      result.push({
        id: "sales",
        label: "Caja y ventas",
        render: () => <SalePanel permissions={permissions} />,
      });
    }

    if (permissions.has("PAYMENTS_PAYMENT_READ") &&
        hasAny(permissions, ["PAYMENTS_TRANSFER_CONFIRM", "PAYMENTS_PAYMENT_CANCEL"])) {
      result.push({
        id: "payment-review",
        label: "Revisar transferencias",
        render: () => <TransferReviewPanel permissions={permissions} />,
      });
    }

    if (permissions.has("FISCAL_DOCUMENT_ISSUE")) {
      result.push({
        id: "fiscal",
        label: "Facturación electrónica",
        render: () => <FiscalPanel />,
      });
    }

    if (hasAny(permissions, ["CATALOG_PRODUCT_READ", "CATALOG_PRODUCT_REGISTER"])) {
      result.push({
        id: "catalog",
        label: "Catálogo",
        render: () => <CatalogPanel permissions={permissions} entitlements={entitlements} />,
      });
    }

    if (hasAny(permissions, [
      "INVENTORY_STOCK_READ",
      "INVENTORY_STOCK_RECEIVE",
      "INVENTORY_STOCK_ADJUST",
    ])) {
      result.push({
        id: "inventory",
        label: "Inventario",
        render: () => <InventoryPanel permissions={permissions} entitlements={entitlements} />,
      });
    }

    if (hasAny(permissions, [
      "CUSTOMERS_CUSTOMER_READ",
      "CUSTOMERS_CUSTOMER_REGISTER",
    ])) {
      result.push({
        id: "customers",
        label: "Clientes",
        render: () => <CustomerPanel />,
      });
    }

    if (permissions.has("SALES_RECEIPT_READ")) {
      result.push({
        id: "receipts",
        label: "Comprobantes",
        render: () => <ReceiptPanel canPrint={permissions.has("HARDWARE_PRINT")} />,
      });
    }

    if (permissions.has("HARDWARE_READ") && permissions.has("HARDWARE_CONFIGURE")) {
      result.push({ id: "hardware", label: "Impresora y cajón", render: () => <HardwarePanel /> });
    }

    if (localSession.role === "ADMINISTRADOR" && permissions.has("AUDIT_EVENT_READ")) {
      result.push({ id: "dashboard", label: "Dashboard", render: () => <AdministrativeControlPanel /> });
    }

    if (permissions.has("AUDIT_EVENT_READ")) {
      // Local SUPERADMINISTRADOR is audit-only development authority — never the
      // GLOBAL platform portal and never commercial admin.metrics / FACTUS UX.
      result.push({
        id: "admin-audit",
        label: "Auditoría administrativa",
        render: () => <LocalAdministrativeAuditPanel />,
      });
    }

    return orderScreensByRole(result, localSession.role);
  }, [authorization, localSession.role, localSession.ready]);

  useEffect(() => {
    if (activeScreen !== null || screens.length === 0) return;
    const home = homeScreenId(screens, localSession.role);
    if (home !== null) setActiveScreen(home);
  }, [activeScreen, screens, localSession.role]);

  if (authorization.phase !== "ready" || !localSession.ready) {
    const loading = authorization.phase === "loading" || (authorization.phase === "ready" && !localSession.ready);
    const unauthenticated = authorization.phase === "unauthenticated";
    return (
      <main className="pos-entry" aria-busy={loading}>
        <section className="pos-entry-brand" aria-label="Identidad Camacho POS Colombia">
          <div className="pos-entry-brand-content">
            <BrandMark variant="entry" />
            <h2>Acceso seguro al<br />punto de venta</h2>
            <p>Inicia sesión para continuar con tu operación.</p>
          </div>
        </section>
        <div className="pos-entry-form-column">
          <section className="pos-entry-card" aria-label="Estado de acceso">
            <span className="pos-entry-eyebrow">CAMACHO POS COLOMBIA</span>
            <h1>Iniciar sesión</h1>
            <p className="pos-entry-lead">
              {loading
                ? "Validando sesión"
                : unauthenticated
                  ? "Accede con tu cuenta local para continuar"
                  : authorization.phase === "denied"
                    ? "Acceso denegado"
                    : authorization.phase === "expired"
                      ? "Sesión expirada"
                      : "Acceso no disponible"}
            </p>
            <p className="pos-entry-copy">
              {loading
                ? "Comprobando la sesión y los permisos efectivos."
                : unauthenticated
                  ? "Identifícate para acceder a las funciones locales autorizadas de tu perfil."
                  : "El POS no ha podido verificar una sesión autorizada."}
            </p>
            {loading ? (
              <div data-testid="authorization-loading" role="status" className="pos-entry-banner pos-entry-banner--info">
                Cargando permisos…
              </div>
            ) : unauthenticated ? (
              <div data-testid="authorization-unauthenticated" role="status" className="pos-entry-banner pos-entry-banner--info">
                No hay una sesión iniciada en este dispositivo.
              </div>
            ) : authorization.phase === "denied" ? (
              <div data-testid="authorization-denied" role="alert" className="pos-entry-banner pos-entry-banner--warning">
                La sesión no dispone de permisos efectivos para operar en este POS.
              </div>
            ) : authorization.phase === "expired" ? (
              <div data-testid="authorization-expired" role="alert" className="pos-entry-banner pos-entry-banner--warning">
                La verificación del backend indica que la sesión expiró. Es necesario autenticarse de nuevo.
              </div>
            ) : authorization.phase === "error" ? (
              <div data-testid="authorization-error" role="alert" className="pos-entry-banner pos-entry-banner--error">
                {authorization.message}
              </div>
            ) : null}
            {unauthenticated && <LocalOperatorLoginPanel onAuthenticated={refreshAccess} />}
            <button type="button" className="pos-entry-secondary" onClick={refreshAccess} disabled={loading}>
              Actualizar acceso
            </button>
            <StatusPanel />
          </section>
          <InstitutionalWebsiteLink />
        </div>
      </main>
    );
  }

  const selectedScreen = screens.find((screen) => screen.id === activeScreen) ?? screens[0] ?? null;

  return (
    <main className="pos-shell" data-navigation-open={navigationOpen} data-operator-role={localSession.role ?? "none"}>
      <a className="pos-skip-link" href="#pos-workspace">Saltar al área de trabajo</a>
      <aside id="pos-navigation" className="pos-sidebar" aria-label="Navegación principal" hidden={!navigationOpen}>
        <BrandMark variant="sidebar" />
        <p className="pos-brand-name">Camacho POS Colombia</p>
        <p className="pos-subtitle">
          {localSession.role === "CAJERO"
            ? "Caja"
            : localSession.role === "SUPERVISOR"
              ? "Supervisión"
              : localSession.role === "ADMINISTRADOR"
                ? "Administración"
                : localSession.role === "SUPERADMINISTRADOR"
                  ? "Auditoría local (no GLOBAL)"
                  : "Acceso según permisos efectivos"}
        </p>
        <nav className="pos-nav">
          {screens.map((screen) => (
            <button
              key={screen.id}
              type="button"
              className="pos-nav-button"
              aria-current={selectedScreen?.id === screen.id ? "page" : undefined}
              onClick={() => { navigateTo(screen.id, selectedScreen?.id ?? null); }}
            >
              {screen.label}
            </button>
          ))}
        </nav>
        <LocalOperatorSessionControl onSessionChanged={refreshAccess} />
      </aside>

      <div className="pos-content" id="pos-workspace" tabIndex={-1}>
        <header className="pos-header">
          <button className="pos-navigation-toggle" type="button" aria-controls="pos-navigation"
            aria-expanded={navigationOpen} aria-label={navigationOpen ? "Ocultar menú" : "Mostrar menú"}
            onClick={() => setNavigationOpen(open => !open)}>
            <img src={navigationOpen ? new URL("./assets/payment-icons/chevron-left.svg", import.meta.url).href : new URL("./assets/payment-icons/chevron-right.svg", import.meta.url).href} alt="" />
          </button>
          <div>
            <p className="pos-product-name">Camacho POS Colombia</p>
            <h1>{selectedScreen?.label ?? "Sin acceso operativo"}</h1>
            <p>Acceso disponible según la autorización efectiva de la sesión.</p>
          </div>
        </header>

        <section className="pos-status">
          <StatusPanel />
        </section>

        <section className="pos-screen" aria-label="Pantalla activa">
          {selectedScreen ? (
            screens.map((screen) => (
              <div key={screen.id} hidden={screen.id !== selectedScreen.id}>
                {(screen.id === selectedScreen.id || visitedScreens.has(screen.id)) && screen.render()}
              </div>
            ))
          ) : (
            <div data-testid="no-authorized-screens">
              No hay pantallas comerciales disponibles para los permisos de esta sesión.
            </div>
          )}
        </section>

        <section className="pos-operation" aria-label="Consulta de operaciones">
          <OperationPanel />
        </section>
      </div>
    </main>
  );
}

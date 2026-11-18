import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";
import { StatusPanel } from "./components/StatusPanel.js";
import { LocalOperatorLoginPanel } from "./components/LocalOperatorLoginPanel.js";
import { LocalOperatorSessionControl } from "./components/LocalOperatorSessionControl.js";
import { OperationPanel } from "./components/OperationPanel.js";
import { SalePanel } from "./components/SalePanel.js";
import { ReceiptPanel } from "./components/ReceiptPanel.js";
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
  const authorization = useAuthorizationCapabilities();
  const [sessionEpoch, setSessionEpoch] = useState(0);
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

    if (hasAny(permissions, [
      "CASH_SHIFT_OPEN",
      "CASH_SHIFT_CLOSE",
      "SALES_SALE_CREATE",
      "PAYMENTS_PAYMENT_REGISTER",
      "PAYMENTS_TRANSFER_REPORT",
      "PAYMENTS_TRANSFER_CONFIRM",
    ])) {
      result.push({
        id: "sales",
        label: "Caja y ventas",
        render: () => <SalePanel />,
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
        render: () => <ReceiptPanel />,
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
        <section className="pos-entry-card" aria-label="Estado de acceso">
          <span className="pos-entry-eyebrow">CAMACHO POS COLOMBIA</span>
          <h1>Iniciar sesión</h1>
          <h2>
            {loading
              ? "Validando sesión"
              : unauthenticated
                ? "Accede con tu cuenta local para continuar"
                : authorization.phase === "denied"
                  ? "Acceso denegado"
                  : authorization.phase === "expired"
                    ? "Sesión expirada"
                    : "Acceso no disponible"}
          </h2>
          <p>
            {loading
              ? "Comprobando la sesión y los permisos efectivos."
              : unauthenticated
                ? "Identifícate para acceder a las funciones locales autorizadas de tu perfil."
                : "El POS no ha podido verificar una sesión autorizada."}
          </p>
          {loading ? (
            <div data-testid="authorization-loading" role="status">Cargando permisos…</div>
          ) : unauthenticated ? (
            <div data-testid="authorization-unauthenticated" role="status">
              No hay una sesión iniciada en este dispositivo.
            </div>
          ) : authorization.phase === "denied" ? (
            <div data-testid="authorization-denied" role="alert">
              La sesión no dispone de permisos efectivos para operar en este POS.
            </div>
          ) : authorization.phase === "expired" ? (
            <div data-testid="authorization-expired" role="alert">
              La verificación del backend indica que la sesión expiró. Es necesario autenticarse de nuevo.
            </div>
          ) : authorization.phase === "error" ? (
            <div data-testid="authorization-error" role="alert">
              No se pudo cargar la autorización: {authorization.message}
            </div>
          ) : null}
          {unauthenticated && <LocalOperatorLoginPanel onAuthenticated={refreshAccess} />}
          <button type="button" onClick={refreshAccess} disabled={loading}>Actualizar acceso</button>
          <StatusPanel />
        </section>
      </main>
    );
  }

  const selectedScreen = screens.find((screen) => screen.id === activeScreen) ?? screens[0] ?? null;

  return (
    <main className="pos-shell" data-operator-role={localSession.role ?? "none"}>
      <aside className="pos-sidebar" aria-label="Navegación principal">
        <div className="pos-brand-mark" role="img" aria-label="Camacho POS Colombia" />
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

      <div className="pos-content">
        <header className="pos-header">
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

        <section className="pos-operation" aria-label="Operación técnica">
          <OperationPanel />
        </section>
      </div>
    </main>
  );
}

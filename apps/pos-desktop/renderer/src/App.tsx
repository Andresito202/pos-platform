import { useMemo, useState } from "react";
import "./App.css";
import { StatusPanel } from "./components/StatusPanel.js";
import { OperationPanel } from "./components/OperationPanel.js";
import { SalePanel } from "./components/SalePanel.js";
import { ReceiptPanel } from "./components/ReceiptPanel.js";
import { CatalogPanel } from "./components/CatalogPanel.js";
import { InventoryPanel } from "./components/InventoryPanel.js";
import { CustomerPanel } from "./components/CustomerPanel.js";
import { FiscalPanel } from "./components/FiscalPanel.js";
import { AdministrativeControlPanel } from "./components/AdministrativeControlPanel.js";

type PlannedScreenDefinition = {
  id: string;
  label: string;
  section: "Administración" | "Plataforma";
  description: string;
  actions: readonly string[];
  requiredPermissions: readonly string[];
};

const plannedScreens: readonly PlannedScreenDefinition[] = [
  { id: "dashboard", label: "Dashboard", section: "Administración", description: "Resumen operativo, indicadores y alertas.", actions: ["Ver indicadores", "Ver alertas", "Actualizar resumen"], requiredPermissions: ["SALES_SALE_CREATE", "INVENTORY_STOCK_READ", "CASH_SHIFT_OPEN"] },
  { id: "reports", label: "Reportes", section: "Administración", description: "Consultas y reportes comerciales y operativos.", actions: ["Ventas", "Inventario", "Caja", "Exportar"], requiredPermissions: ["SALES_RECEIPT_READ", "INVENTORY_STOCK_READ", "CASH_SHIFT_OPEN"] },
  { id: "users", label: "Usuarios", section: "Administración", description: "Alta, consulta, suspensión y administración de usuarios.", actions: ["Nuevo usuario", "Consultar usuario", "Suspender usuario", "Restablecer contraseña", "Revocar sesión"], requiredPermissions: ["tenant.owner.change", "TENANT_OWNER_CHANGE"] },
  { id: "roles", label: "Roles y permisos", section: "Administración", description: "Asignación de roles, permisos y alcance organizacional.", actions: ["Gestionar roles", "Asignar permisos", "Revisar alcance"], requiredPermissions: ["security.permission.change", "SECURITY_PERMISSION_CHANGE"] },
  { id: "company", label: "Empresa", section: "Administración", description: "Datos y configuración de la empresa.", actions: ["Editar empresa", "Datos fiscales", "Políticas"], requiredPermissions: ["tenant.owner.change", "TENANT_OWNER_CHANGE"] },
  { id: "branches", label: "Sucursales", section: "Administración", description: "Alta y administración de sucursales.", actions: ["Nueva sucursal", "Consultar sucursal", "Desactivar sucursal"], requiredPermissions: ["tenant.owner.change", "TENANT_OWNER_CHANGE"] },
  { id: "devices", label: "Dispositivos", section: "Administración", description: "Registro, aprobación, actividad y ciclo de vida de dispositivos.", actions: ["Registrar dispositivo", "Aprobar dispositivo", "Reemplazar dispositivo"], requiredPermissions: ["DEVICE_REVOKE"] },
  { id: "settings", label: "Configuración", section: "Administración", description: "Configuración general del entorno POS.", actions: ["Configuración general", "Sesión y seguridad", "Cambiar contraseña", "Cerrar sesiones", "Integraciones"], requiredPermissions: ["authorization.policy.read", "AUTHORIZATION_POLICY_READ", "security.permission.change", "SECURITY_PERMISSION_CHANGE"] },
  { id: "licenses", label: "Licencias", section: "Plataforma", description: "Ciclo de vida de licencias y estado contractual.", actions: ["Emitir licencia", "Renovar", "Suspender", "Reactivar", "Revocar"], requiredPermissions: ["license.plan.change", "LICENSE_PLAN_CHANGE"] },
  { id: "plans", label: "Planes y suscripciones", section: "Plataforma", description: "Planes mensual, anual y perpetuo; suscripciones y derechos.", actions: ["Nuevo plan", "Cambiar plan", "Gestionar suscripción", "Consultar entitlements"], requiredPermissions: ["license.plan.change", "LICENSE_PLAN_CHANGE"] },
  { id: "super-admin", label: "Superadministrador", section: "Plataforma", description: "Administración global de plataforma, licencias y cuentas.", actions: ["Administrar cuentas", "Administrar licencias", "Administrar planes", "Iniciar recuperación asistida", "Revisar auditoría"], requiredPermissions: ["tenant.owner.change", "TENANT_OWNER_CHANGE", "license.plan.change", "LICENSE_PLAN_CHANGE"] },
  { id: "support", label: "Soporte", section: "Plataforma", description: "Atención operativa y acciones autorizadas de soporte.", actions: ["Buscar cuenta", "Revisar dispositivo", "Registrar caso"], requiredPermissions: ["SUPPORT_ACCOUNT_READ", "DEVICE_REVOKE"] },
  { id: "admin-audit", label: "Auditoría administrativa", section: "Plataforma", description: "Trazabilidad de acciones administrativas y de plataforma.", actions: ["Consultar eventos", "Filtrar eventos"], requiredPermissions: ["AUDIT_EVENT_READ"] },
];

function PlannedScreen({ screen }: { screen: PlannedScreenDefinition }): React.JSX.Element {
  if (screen.id === "dashboard") return <AdministrativeControlPanel kind="admin" />;
  if (screen.id === "super-admin") return <AdministrativeControlPanel kind="superadmin" />;
  if (screen.id === "admin-audit") return <AdministrativeControlPanel kind="audit" />;

  return (
    <section data-testid={`planned-screen-${screen.id}`}>
      <h2>{screen.label}</h2>
      <p>{screen.description}</p>
      <p className="pos-planned-state">Superficie de navegación materializada · las operaciones requieren contrato ejecutable y autorización backend.</p>
      <div className="pos-action-grid">
        {screen.actions.map((action) => (
          <button key={action} type="button" disabled title="La operación requiere un contrato de servicio ejecutable.">
            {action}
          </button>
        ))}
      </div>
    </section>
  );
}
import { useAuthorizationCapabilities } from "./hooks/useAuthorizationCapabilities.js";

function hasAny(permissions: ReadonlySet<string>, required: readonly string[]): boolean {
  return required.some((permission) => permissions.has(permission));
}

type Screen = {
  id: string;
  label: string;
  section: "Operación" | "Catálogo e inventario" | "Administración" | "Plataforma";
  render: () => React.JSX.Element;
  planned?: boolean;
};

export function App(): React.JSX.Element {
  const authorization = useAuthorizationCapabilities();
  const [activeScreen, setActiveScreen] = useState<string | null>(null);

  const screens = useMemo<Screen[]>(() => {
    if (authorization.phase !== "ready") return [];

    const { permissions } = authorization;
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
        section: "Operación",
        render: () => <SalePanel />,
      });
    }

    if (permissions.has("FISCAL_DOCUMENT_ISSUE")) {
      result.push({
        id: "fiscal",
        label: "Facturación electrónica",
        section: "Operación",
        render: () => <FiscalPanel />,
      });
    }

    if (hasAny(permissions, ["CATALOG_PRODUCT_READ", "CATALOG_PRODUCT_REGISTER"])) {
      result.push({
        id: "catalog",
        label: "Catálogo",
        section: "Catálogo e inventario",
        render: () => <CatalogPanel />,
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
        section: "Catálogo e inventario",
        render: () => <InventoryPanel />,
      });
    }

    if (hasAny(permissions, [
      "CUSTOMERS_CUSTOMER_READ",
      "CUSTOMERS_CUSTOMER_REGISTER",
    ])) {
      result.push({
        id: "customers",
        label: "Clientes",
        section: "Operación",
        render: () => <CustomerPanel />,
      });
    }

    if (permissions.has("SALES_RECEIPT_READ")) {
      result.push({
        id: "receipts",
        label: "Comprobantes",
        section: "Operación",
        render: () => <ReceiptPanel />,
      });
    }

    for (const planned of plannedScreens) {
      if (!hasAny(permissions, planned.requiredPermissions)) continue;
      result.push({
        id: planned.id,
        label: planned.label,
        section: planned.section,
        planned: true,
        render: () => <PlannedScreen screen={planned} />,
      });
    }

    return result;
  }, [authorization]);

  if (authorization.phase === "loading") {
    return (
      <main>
        <h1>Camacho POS Colombia</h1>
        <StatusPanel />
        <div data-testid="authorization-loading">Cargando permisos…</div>
      </main>
    );
  }

  if (authorization.phase === "error") {
    return (
      <main>
        <h1>Camacho POS Colombia</h1>
        <StatusPanel />
        <div data-testid="authorization-error">
          No se pudo cargar la autorización: {authorization.message}
        </div>
      </main>
    );
  }

  const selectedScreen = screens.find((screen) => screen.id === activeScreen) ?? screens[0] ?? null;

  return (
    <main className="pos-shell">
      <aside className="pos-sidebar" aria-label="Navegación principal">
        <div className="pos-brand-mark" role="img" aria-label="Camacho POS Colombia" />
        <p className="pos-brand-name">Camacho POS Colombia</p>
        <p className="pos-subtitle">Acceso según permisos efectivos</p>
        <nav className="pos-nav">
          {(["Operación", "Catálogo e inventario", "Administración", "Plataforma"] as const).map((section) => {
            const sectionScreens = screens.filter((screen) => screen.section === section);
            if (sectionScreens.length === 0) return null;

            return (
              <div key={section} className="pos-nav-section">
                <p className="pos-nav-section-title">{section}</p>
                {sectionScreens.map((screen) => (
                  <button
                    key={screen.id}
                    type="button"
                    className={`pos-nav-button${screen.planned ? " pos-nav-button-planned" : ""}`}
                    aria-current={selectedScreen?.id === screen.id ? "page" : undefined}
                    onClick={() => { setActiveScreen(screen.id); }}
                  >
                    {screen.label}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>

      <div className="pos-content">
        <header className="pos-header">
          <div>
            <p className="pos-product-name">Camacho POS Colombia</p>
            <h1>{selectedScreen?.label ?? "Sin acceso operativo"}</h1>
            <p>Acceso disponible según la autorización efectiva de la sesión. Las interfaces administrativas ya están identificadas; sus acciones se conectan al servicio real por bloque.</p>
          </div>
        </header>

        <section className="pos-status">
          <StatusPanel />
        </section>

        <section className="pos-screen" aria-label="Pantalla activa">
          {selectedScreen ? (
            selectedScreen.render()
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

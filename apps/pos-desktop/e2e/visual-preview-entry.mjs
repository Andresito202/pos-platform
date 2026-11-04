/**
 * ISOLATED E2E VISUAL PREVIEW ONLY.
 * This is NOT the commercial login and must never be imported into production.
 * These named profiles are navigation examples, not actual RBAC role definitions.
 * Every request except the mock capabilities read is explicitly rejected.
 */
import { BrowserWindow } from "electron";
import { bootstrap } from "../dist/main.js";

const cashier = Object.freeze([
  "CASH_SHIFT_OPEN", "CASH_SHIFT_CLOSE",
  "SALES_SALE_CREATE",
  "PAYMENTS_PAYMENT_REGISTER", "PAYMENTS_TRANSFER_REPORT",
  "PAYMENTS_TRANSFER_CONFIRM", "PAYMENTS_PAYMENT_READ",
  "PAYMENTS_PAYMENT_CANCEL",
  "SALES_RECEIPT_READ", "FISCAL_DOCUMENT_ISSUE",
  "CUSTOMERS_CUSTOMER_READ", "CUSTOMERS_CUSTOMER_REGISTER",
]);

const admin = Object.freeze([
  ...cashier,
  "AUDIT_EVENT_READ", "CATALOG_PRODUCT_READ", "CATALOG_PRODUCT_REGISTER",
  "INVENTORY_STOCK_RECEIVE", "INVENTORY_STOCK_READ",
  "INVENTORY_STOCK_ADJUST", "HARDWARE_READ",
]);

const profiles = Object.freeze({
  cashier: Object.freeze({ label: "CAJERO", capabilities: cashier }),
  admin: Object.freeze({ label: "ADMINISTRADOR", capabilities: admin }),
  // No dedicated superadmin screen is exposed by the current React renderer.
  // This profile intentionally reuses the admin navigation; it is NOT an
  // implementation or a statement of real superadmin privileges.
  superadmin: Object.freeze({ label: "SUPERADMINISTRADOR (VISTA ACTUAL COMPARTIDA)", capabilities: admin }),
});

const requested = (process.env.POS_VISUAL_ROLE ?? "admin").toLowerCase();
if (!Object.hasOwn(profiles, requested)) {
  throw new Error("Unknown POS_VISUAL_ROLE. Use cashier, admin or superadmin.");
}
const profile = profiles[requested];

const visualOnlyChannel = {
  async request(envelope) {
    if (envelope !== null && typeof envelope === "object" &&
        envelope.message_type === "authorization.capabilities.get") {
      return {
        status: "SUCCEEDED",
        result_code: "AVAILABLE",
        result: { outcome: "AVAILABLE", permissions: [...profile.capabilities] },
      };
    }
    return { status: "REJECTED", result_code: "VISUAL_PREVIEW_NO_BACKEND", result: null };
  },
  async close() {},
};

bootstrap(visualOnlyChannel).then(async () => {
  const window = BrowserWindow.getAllWindows()[0];
  if (!window) throw new Error("Visual preview window missing");
  window.setTitle("VISTA VISUAL " + profile.label + " — Camacho POS Colombia");
  const caption = "VISTA VISUAL · " + profile.label +
    " · PERMISOS DE EJEMPLO · SIN LOGIN NI SERVICIO LOCAL · OPERACIONES BLOQUEADAS";
  const bannerScript = [
    "(() => {",
    " if (document.getElementById('pos-visual-preview-banner')) return;",
    " const banner = document.createElement('div');",
    " banner.id = 'pos-visual-preview-banner';",
    " banner.textContent = " + JSON.stringify(caption) + ";",
    " banner.style.cssText = [",
    "  'position:fixed','left:0','right:0','top:0','z-index:2147483647',",
    "  'background:#20252d','color:#fff','font:600 12px Arial,sans-serif',",
    "  'letter-spacing:.035em','text-align:center','padding:7px',",
    "  'pointer-events:none','box-shadow:0 1px 6px #0005'",
    " ].join(';');",
    " document.body.appendChild(banner);",
    "})();",
  ].join("\n");
  await window.webContents.executeJavaScript(bannerScript);
}).catch((error) => {
  console.error("VISUAL_PREVIEW_BOOT_FAILED", error);
  process.exitCode = 1;
});

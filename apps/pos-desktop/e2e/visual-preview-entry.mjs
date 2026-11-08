/**
 * MANUAL VISUAL INSPECTION ONLY — not an application entrypoint or login.
 * Lives only in e2e/; never in the production desktop build.
 * Real compiled Electron/preload/React; isolated visual stub, no POS service.
 *
 * Operations, session activation and all writes are deliberately rejected.
 * A visible watermark prevents confusion with an authenticated POS.
 */
import { BrowserWindow } from "electron";
import { bootstrap } from "../dist/main.js";

// Capability list matches App.tsx's current visual-navigation gates,
// exclusively for this test-only entry. No real authorization is conferred.
const previewCapabilities = Object.freeze([
  "AUDIT_EVENT_READ",
  "CASH_SHIFT_OPEN", "CASH_SHIFT_CLOSE",
  "SALES_SALE_CREATE", "PAYMENTS_PAYMENT_REGISTER",
  "PAYMENTS_TRANSFER_REPORT", "PAYMENTS_TRANSFER_CONFIRM",
  "PAYMENTS_PAYMENT_READ", "PAYMENTS_PAYMENT_CANCEL",
  "SALES_RECEIPT_READ", "FISCAL_DOCUMENT_ISSUE",
  "CATALOG_PRODUCT_READ", "CATALOG_PRODUCT_REGISTER",
  "INVENTORY_STOCK_RECEIVE", "INVENTORY_STOCK_READ",
  "INVENTORY_STOCK_ADJUST",
  "CUSTOMERS_CUSTOMER_READ", "CUSTOMERS_CUSTOMER_REGISTER",
]);

const visualOnlyChannel = {
  async request(envelope) {
    if (envelope !== null && typeof envelope === "object"
      && envelope.message_type === "authorization.capabilities.get") {
      return {
        status: "SUCCEEDED",
        // Match the canonical read-only capability response; the visual-only
        // provenance remains explicit in the Electron banner and no commercial
        // request or write can be completed in this preview stub.
        result_code: "AVAILABLE",
        result: { outcome: "AVAILABLE", permissions: [...previewCapabilities] },
      };
    }
    // No commercial data, fabricated session, payment or permission writes.
    return { status: "REJECTED", result_code: "VISUAL_PREVIEW_NO_BACKEND", result: null };
  },
  async close() {},
};

bootstrap(visualOnlyChannel).then(async () => {
  const window = BrowserWindow.getAllWindows()[0];
  if (!window) throw new Error("Visual preview window missing");
  window.setTitle("VISTA VISUAL SIN AUTENTICACIÓN — Camacho POS Colombia");
  const bannerScript = [
    "(() => {",
    " if (document.getElementById('pos-visual-preview-banner')) return;",
    " const banner = document.createElement('div');",
    " banner.id = 'pos-visual-preview-banner';",
    " banner.textContent = 'VISTA VISUAL · SIN LOGIN NI SERVICIO LOCAL · OPERACIONES DESHABILITADAS';",
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

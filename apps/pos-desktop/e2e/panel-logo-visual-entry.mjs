/**
 * Electron entry for panel-logo *visual* evidence only (e2e harness).
 *
 * Stub channel paints ADMINISTRADOR / CAJERO shells so BrandMark + logo-stage
 * CSS can be screenshot. Not a commercial session. Not SSA/SAS. Not production
 * entry. Must never be imported by runtime/production bundles.
 */
import { bootstrap } from "../dist/main.js";

const ROLE = process.env.POS_LOGO_VISUAL_ROLE === "CAJERO" ? "CAJERO" : "ADMINISTRADOR";
const USERNAME = ROLE === "CAJERO" ? "cajero.logo.visual" : "admin.logo.visual";


function localOperatorAuthenticated() {
  return {
    protocol_version: "1.0.0",
    request_id: "11111111-1111-4111-8111-111111111111",
    correlation_id: "11111111-1111-4111-8111-111111111112",
    operation_id: null,
    status: "SUCCEEDED",
    result_code: "AUTHENTICATED",
    result_schema_version: "1.0.0",
    error: null,
    server_time: "2026-11-23T00:00:00.000Z",
    result: {
      outcome: "AUTHENTICATED",
      username: USERNAME,
      role: ROLE,
      expires_at: "2099-01-01T00:00:00.000Z",
    },
  };
}

function localOperatorEnvelope(outcome) {
  return {
    protocol_version: "1.0.0",
    request_id: "11111111-1111-4111-8111-111111111111",
    correlation_id: "11111111-1111-4111-8111-111111111112",
    operation_id: null,
    status: "SUCCEEDED",
    result_code: outcome,
    result_schema_version: "1.0.0",
    error: null,
    server_time: "2026-11-23T00:00:00.000Z",
    result: {
      outcome,
      username: null,
      role: null,
      expires_at: null,
    },
  };
}

function capabilities() {
  return {
    status: "SUCCEEDED",
    result_code: "AVAILABLE",
    result: {
      outcome: "AVAILABLE",
      permissions: [
        "SALES_SALE_CREATE",
        "CATALOG_PRODUCT_READ",
        "CUSTOMERS_CUSTOMER_READ",
        "INVENTORY_STOCK_READ",
        "FISCAL_DOCUMENT_ISSUE",
        "SALES_RECEIPT_READ",
        "AUDIT_EVENT_READ",
      ],
      entitlements: [],
    },
  };
}

function recoverNone() {
  return {
    status: "SUCCEEDED",
    result_code: "NONE",
    result: {
      outcome: "NONE",
      session_id: null,
      offline_valid_until: null,
      decision: null,
    },
  };
}

function emptyList(code = "FOUND") {
  return {
    status: "SUCCEEDED",
    result_code: code,
    result: { outcome: code, items: [], carts: [], has_more: false },
  };
}

const stubChannel = {
  request: (requestInput) => {
    const messageType =
      typeof requestInput === "object"
      && requestInput !== null
      && "message_type" in requestInput
        ? requestInput.message_type
        : undefined;

    if (messageType === "authorization.capabilities.get") {
      return Promise.resolve(capabilities());
    }
    if (messageType === "session.recover") {
      return Promise.resolve(recoverNone());
    }
    if (messageType === "local.operator.session" || messageType === "local.operator.login") {
      return Promise.resolve(localOperatorAuthenticated());
    }
    if (messageType === "local.operator.logout") {
      return Promise.resolve(localOperatorEnvelope("SIGNED_OUT"));
    }
    if (messageType === "runtime.status.get") {
      return Promise.resolve({
        protocol_version: "1.0.0",
        request_id: "11111111-1111-4111-8111-111111111111",
        correlation_id: "11111111-1111-4111-8111-111111111112",
        operation_id: null,
        status: "SUCCEEDED",
        result_code: "OK",
        result_schema_version: "1.0.0",
        error: null,
        server_time: "2026-11-23T00:00:00.000Z",
        result: {
          service_version: "1.0.0",
          protocol_version: "1.0.0",
          service_state: "READY",
          schema_version: "5",
        },
      });
    }
    if (
      messageType === "catalog.item.list"
      || messageType === "cart.waiting.list"
      || messageType === "customers.customer.list"
      || messageType === "inventory.stock.list"
      || messageType === "sales.receipt.list"
      || messageType === "audit.event.list"
      || messageType === "admin.metrics.get"
    ) {
      return Promise.resolve(emptyList());
    }

    return Promise.resolve({
      status: "SUCCEEDED",
      result_code: "OK",
      result: null,
    });
  },
  close: () => Promise.resolve(),
};

bootstrap(stubChannel).catch((error) => {
  console.error("panel-logo-visual-entry bootstrap failed", error);
  process.exit(1);
});

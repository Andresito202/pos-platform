/**
 * Entrada de Electron **exclusiva de E2E**.
 *
 * `src/main.ts` exporta `bootstrap(serviceChannel)` y **no se auto-ejecuta**: el
 * canal hacia el POS Local Service se le inyecta. Desde el Bloque 4 existe el
 * adaptador real —`src/local-service-channel.ts` sobre
 * `@pos-platform/local-channel`—, pero la entrada de producción sigue
 * bloqueada: el protocolo exige firmar **desde la primera trama**, y decidir de
 * dónde sale esa clave sin entregarle al Desktop el secreto persistente es una
 * decisión abierta.
 *
 * Este archivo **no es esa entrada**. Es un doble de prueba, del mismo tipo que
 * `makeServiceChannel()` en `tests/main.test.ts`, y sirve para comprobar que el
 * proceso principal compilado arranca, carga preload/renderer y expone
 * `window.posService`.
 *
 * Para autorización responde el contrato real de sesión no vinculada
 * (`SESSION_NOT_BOUND` → `session.recover` NONE). No concede permisos ni
 * simula una sesión comercial autenticada.
 */
import { bootstrap } from "../dist/main.js";

function unboundCapabilities() {
  return {
    status: "REJECTED",
    result_code: "SESSION_NOT_BOUND",
    result: { outcome: "UNAUTHORIZED", permissions: [], entitlements: [] },
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
    server_time: "2026-11-10T00:00:00.000Z",
    result: {
      outcome,
      username: null,
      role: null,
      expires_at: null,
    },
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
      return Promise.resolve(unboundCapabilities());
    }
    if (messageType === "session.recover") {
      return Promise.resolve(recoverNone());
    }
    if (messageType === "local.operator.session") {
      return Promise.resolve(localOperatorEnvelope("NO_SESSION"));
    }
    if (messageType === "local.operator.login") {
      // Fail closed: smoke never authenticates an operator.
      return Promise.resolve(localOperatorEnvelope("DENIED"));
    }
    if (messageType === "local.operator.logout") {
      return Promise.resolve(localOperatorEnvelope("SIGNED_OUT"));
    }
    if (messageType === "runtime.status.get") {
      // Contract-valid READY only. This is liveness for the smoke harness —
      // not commercial authorization and not an SSA/SAS grant.
      return Promise.resolve({
        protocol_version: "1.0.0",
        request_id: "11111111-1111-4111-8111-111111111111",
        correlation_id: "11111111-1111-4111-8111-111111111112",
        operation_id: null,
        status: "SUCCEEDED",
        result_code: "OK",
        result_schema_version: "1.0.0",
        error: null,
        server_time: "2026-11-10T00:00:00.000Z",
        result: {
          service_version: "1.0.0",
          protocol_version: "1.0.0",
          service_state: "READY",
          schema_version: "5",
        },
      });
    }

    return Promise.resolve({
      status: "SUCCEEDED",
      result_code: "OK",
      result: null,
    });
  },
  close: () => Promise.resolve(),
};

/**
 * Sin `await` de nivel superior, y es necesario: `bootstrap` no resuelve hasta
 * que `app.whenReady()` lo hace, y un módulo principal que no termina de
 * cargarse deja colgado a cualquier supervisor que espere a que Electron esté
 * listo —Playwright entre ellos—. La entrada de producción tendrá la misma
 * restricción.
 */
bootstrap(stubChannel).catch((error) => {
  console.error("smoke-entry bootstrap failed", error);
  process.exit(1);
});

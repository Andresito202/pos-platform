import { describe, expect, it } from "vitest";
import {
  FACTUS_SANDBOX_ENV,
  FactusAdapter,
  FetchHttpTransport,
  authorizesIssuance,
  type CredentialReference,
  type FactusCredential,
  type FactusCredentialResolver,
  type FiscalConfigurationValidationOutcome,
  type NumberingRangeOutcome,
} from "../src/index.js";

/**
 * Suite de sandbox — nivel 2 de evidencia de `D-4`.
 *
 * **Apagada por defecto y nunca en CI.** Sólo corre si las cuatro variables de
 * entorno están presentes, y CI no las recibe (`fiscal-adapter-gate.md` §12.3).
 * Sale a la red real contra `api-sandbox.factus.com.co`.
 *
 * Cómo ejecutarla, en la máquina del responsable:
 *
 * ```
 * export FACTUS_SANDBOX_CLIENT_ID=...
 * export FACTUS_SANDBOX_CLIENT_SECRET=...
 * export FACTUS_SANDBOX_USERNAME=...
 * export FACTUS_SANDBOX_PASSWORD=...
 * pnpm test:fiscal-adapters
 * ```
 *
 * **Los nombres de variable son públicos; los valores no.** Ninguno aparece en
 * este archivo, ni en fixtures, ni en la salida de las pruebas.
 *
 * Que estas pruebas pasen es lo único que permite mover la declaración de
 * `MOCK_TESTED` a `SANDBOX_VERIFIED`, y ese cambio se hace **a mano, con la
 * evidencia observada**, no automáticamente.
 *
 * Nota de entorno verificada el 2026-09-06: desde el entorno de agente
 * `api-sandbox.factus.com.co` responde `CONNECT tunnel failed, 403`. Esta suite
 * no puede ejecutarse desde allí.
 */

function credentialFromEnvironment(): FactusCredential | undefined {
  const clientId = process.env[FACTUS_SANDBOX_ENV.clientId];
  const clientSecret = process.env[FACTUS_SANDBOX_ENV.clientSecret];
  const username = process.env[FACTUS_SANDBOX_ENV.username];
  const password = process.env[FACTUS_SANDBOX_ENV.password];
  if (
    clientId === undefined || clientSecret === undefined
    || username === undefined || password === undefined
  ) {
    return undefined;
  }
  return { clientId, clientSecret, username, password };
}

const credential = credentialFromEnvironment();

class EnvironmentCredentialResolver implements FactusCredentialResolver {
  constructor(private readonly value: FactusCredential) {}
  async resolve(_reference: CredentialReference): Promise<FactusCredential> {
    return this.value;
  }
}

const REFERENCE: CredentialReference = {
  secretRef: "env:factus:sandbox",
  version: "1",
};

/**
 * Aplana el desenlace a una cadena que **incluye el motivo**.
 *
 * Sin esto, un fallo dice «esperaba SYNCHRONIZED, recibí UNAVAILABLE» y se
 * pierde lo único que permitiría corregirlo: si fue un 404, un 401, un fallo
 * de transporte o un cuerpo que no encaja con la forma asumida. El sandbox sólo
 * es accesible desde la máquina del responsable, así que un diagnóstico perdido
 * cuesta una ronda entera.
 */
function describeConfigurationOutcome(outcome: FiscalConfigurationValidationOutcome): string {
  if (outcome.kind === "VALID") return "VALID";
  if (outcome.kind === "UNDETERMINED") return `UNDETERMINED: ${outcome.reasonCode}`;
  return `INCOMPLETE: ${outcome.findings.map((finding) => `${finding.code}(${finding.fieldName ?? "-"})`).join(", ")}`;
}

function describeRangeOutcome(outcome: NumberingRangeOutcome): string {
  return outcome.kind === "SYNCHRONIZED"
    ? "SYNCHRONIZED"
    : `${outcome.kind}: ${outcome.reasonCode}`;
}

describe.skipIf(credential === undefined)("FACTUS sandbox real (SANDBOX_VERIFIED)", () => {
  it("autentica contra el sandbox real y valida la configuración", async () => {
    if (credential === undefined) throw new Error("rama imposible");
    const adapter = new FactusAdapter(
      new FetchHttpTransport(),
      new EnvironmentCredentialResolver(credential),
      "SANDBOX",
      { now: () => Date.now() },
    );

    try {
      const outcome = await adapter.validateConfiguration(
        {
          environment: "SANDBOX",
          credential: REFERENCE,
          expectedCredentialShape: {
            transport: "OAUTH2_PASSWORD_GRANT",
            tokenLifecycle: "ACCESS_AND_REFRESH_TOKEN",
            fields: [
              { name: "client_id", source: "CUSTOMER", secret: false },
              { name: "client_secret", source: "CUSTOMER", secret: true },
              { name: "username", source: "CUSTOMER", secret: false },
              { name: "password", source: "CUSTOMER", secret: true },
            ],
            neverAccountPassword: false,
          },
        },
        AbortSignal.timeout(30_000),
      );

      // Se afirma el desenlace observado, no un PASS: si el proveedor rechaza
      // la credencial, la prueba debe decirlo, no maquillarlo.
      expect(describeConfigurationOutcome(outcome)).toBe("VALID");
      if (outcome.kind !== "VALID") throw new Error("rama imposible");
      expect(authorizesIssuance(outcome)).toBe(true);
    } finally {
      adapter.close();
    }
  }, 60_000);

  it("sincroniza los rangos de numeración reales y ninguno es de autoridad local", async () => {
    if (credential === undefined) throw new Error("rama imposible");
    const adapter = new FactusAdapter(
      new FetchHttpTransport(),
      new EnvironmentCredentialResolver(credential),
      "SANDBOX",
      { now: () => Date.now() },
    );

    try {
      const outcome = await adapter.synchronizeRanges(
        { documentType: "SALES_INVOICE", environment: "SANDBOX", credential: REFERENCE },
        AbortSignal.timeout(30_000),
      );
      // El aserto lleva el motivo: una prueba que oculta su diagnóstico es
      // inútil justo cuando más falta hace. `UNAVAILABLE` sin `reasonCode` no
      // distingue un 404 de un cuerpo con otra forma.
      expect(describeRangeOutcome(outcome)).toBe("SYNCHRONIZED");
      if (outcome.kind !== "SYNCHRONIZED") throw new Error("rama imposible");
      for (const range of outcome.ranges) {
        expect(range.authority).toBe("PROVIDER");
      }
    } finally {
      adapter.close();
    }
  }, 60_000);
});

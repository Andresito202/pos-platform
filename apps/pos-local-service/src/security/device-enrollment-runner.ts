import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicKey } from "node:crypto";
import * as z from "zod";
import { DeviceEnrollmentResultSchema } from "@pos-platform/contracts";
import { DeviceTrustVerifier, type DeviceTrustClock } from "@pos-platform/device-trust";
import type { CentralTransport } from "../sync/central-transport.js";
import type { DeviceEnrollmentService } from "./device-enrollment-service.js";
import type { DeviceTrustCredentialStore } from "./device-trust-credential-store.js";
import type { DeviceIdentity } from "./device-identity.js";

/**
 * Identidad **pública** del equipo, escrita en el directorio de datos
 * (`DEC-020` enmienda 2026-09-28, `DEC-026` §13.11).
 *
 * El enrolamiento central (`CentralDeviceCredentialIssuer`) exige que el
 * registro del equipo conozca ya su clave pública —compara la de la petición
 * con la registrada—, y ninguna pieza la hacía llegar allí: la clave se genera
 * aquí, en el primer arranque, y no salía de este proceso. Este fichero es esa
 * salida, y sólo lleva lo que ya es público: identificadores, `device_key_id`
 * y la clave pública. La privada sigue sin salir del almacén cifrado.
 *
 * Se reescribe en cada arranque (escritura atómica): es un reflejo del estado,
 * no un dato de entrada, y nadie lo lee de vuelta en este proceso.
 */
export const DEVICE_PUBLIC_IDENTITY_FILE = "device-public-identity.json";

export function writeDevicePublicIdentity(input: {
  readonly dataDirectory: string;
  readonly tenantId: string;
  readonly companyId: string;
  readonly installationId: string;
  readonly deviceId: string;
  readonly identity: DeviceIdentity;
  readonly enrolled: boolean;
}): string {
  const path = join(input.dataDirectory, DEVICE_PUBLIC_IDENTITY_FILE);
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({
    version: 1,
    tenant_id: input.tenantId,
    company_id: input.companyId,
    installation_id: input.installationId,
    device_id: input.deviceId,
    device_key_id: input.identity.deviceKeyId(),
    device_public_key_pem: input.identity.publicKeyPem(),
    enrolled: input.enrolled,
  }, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
  return path;
}

export interface DeviceEnrollmentRunnerConfig {
  readonly centralAuthUrl: string;
  readonly activationPath: string;
  readonly transportTokenPath: string;
  readonly rootPublicKeyPem: string;
  readonly operationalKeyId: string;
  readonly operationalPublicKeyPem: string;
}

export type DeviceEnrollmentRunOutcome =
  | { readonly outcome: "ALREADY_ENROLLED" }
  | { readonly outcome: "NO_ACTIVATION" }
  | { readonly outcome: "ENROLLED"; readonly credentialId: string }
  | { readonly outcome: "NOT_READY"; readonly decision: string }
  | { readonly outcome: "REJECTED"; readonly reason: string };

const EnvelopeSchema = z.object({ result_code: z.string(), result: z.unknown() }).loose();

/**
 * Enrolamiento del equipo por el protocolo canónico de `D-3`: el servicio
 * prepara la petición con `DeviceEnrollmentService` (desafío firmado con su
 * clave), la envía a la autoridad y completa **verificando** la credencial
 * recibida contra las claves públicas configuradas antes de guardarla.
 *
 * No detiene el arranque: un equipo sin enrolar sigue vendiendo con la sesión
 * que tenga; lo único que no puede es iniciar sesión nueva
 * (`DEVICE_NOT_ENROLLED`). Todos los desenlaces se devuelven para el log.
 */
export async function runDeviceEnrollment(dependencies: {
  readonly config: DeviceEnrollmentRunnerConfig;
  readonly service: DeviceEnrollmentService;
  readonly credentialStore: DeviceTrustCredentialStore;
  readonly transport: CentralTransport;
  /** El `TrustedClockGuard` del equipo: la credencial se evalúa con el mismo reloj que todo lo demás. */
  readonly clock: DeviceTrustClock;
  readonly signal: AbortSignal;
}): Promise<DeviceEnrollmentRunOutcome> {
  if (dependencies.credentialStore.has()) return { outcome: "ALREADY_ENROLLED" };

  let activation: unknown;
  try {
    activation = JSON.parse(readFileSync(dependencies.config.activationPath, "utf8"));
  } catch {
    return { outcome: "NO_ACTIVATION" };
  }
  const token = readFileSync(dependencies.config.transportTokenPath, "utf8").trim();
  if (token === "") return { outcome: "REJECTED", reason: "TRANSPORT_TOKEN_EMPTY" };

  const preparation = dependencies.service.prepare(activation);
  if (preparation.decision !== "READY" || preparation.request === null) {
    return { outcome: "NOT_READY", decision: preparation.decision };
  }

  const response = await dependencies.transport.send({
    method: "POST",
    url: new URL("/v1/device-enrollment", dependencies.config.centralAuthUrl).toString(),
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(preparation.request),
    signal: dependencies.signal,
  });
  let envelope: z.infer<typeof EnvelopeSchema>;
  try {
    envelope = EnvelopeSchema.parse(JSON.parse(response.body));
  } catch {
    return { outcome: "REJECTED", reason: `HTTP_${String(response.status)}` };
  }
  if (envelope.result_code !== "ENROLLED") {
    return { outcome: "REJECTED", reason: /^[A-Z0-9_.-]{1,128}$/.test(envelope.result_code) ? envelope.result_code : "UNKNOWN" };
  }

  const verifier = new DeviceTrustVerifier(
    createPublicKey(dependencies.config.rootPublicKeyPem),
    new Map([[dependencies.config.operationalKeyId, {
      key: createPublicKey(dependencies.config.operationalPublicKeyPem),
      status: "ACTIVE" as const,
      validFrom: new Date(0).toISOString(),
    }]]),
    dependencies.clock,
  );
  const result = dependencies.service.complete(DeviceEnrollmentResultSchema.parse(envelope.result), verifier);
  return { outcome: "ENROLLED", credentialId: result.credential_id ?? "" };
}

/**
 * ¿Responde la autoridad? `GET /health` con tiempo acotado. Se consulta antes
 * de preparar un enrolamiento: preparar deja un asiento `PENDING` que no se
 * reenvía, así que sólo se prepara cuando hay a quién enviarlo.
 */
export async function centralAuthReachable(centralAuthUrl: string, timeoutMs = 5_000): Promise<boolean> {
  try {
    const response = await fetch(new URL("/health", centralAuthUrl), { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok;
  } catch {
    return false;
  }
}

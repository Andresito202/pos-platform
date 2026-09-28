import { readFileSync } from "node:fs";
import {
  OperatorSessionProvisioningArtifactSchema,
  type OperatorSessionProvisioningArtifact,
} from "@pos-platform/contracts";
import type { SnapshotBinding } from "../authorization/authorization-snapshot-store.js";
import type { SnapshotProvider } from "../authorization/snapshot-provider.js";
import { SnapshotAcquisitionService } from "../authorization/snapshot-acquisition.js";
import { AuthorizationSnapshotVerifier } from "../security/authorization-snapshot-verifier.js";

/**
 * Lectura del artefacto de aprovisionamiento de sesión (`DEC-025`).
 *
 * El artefacto lo firma el propietario fuera del repositorio. Aquí sólo se lee
 * y se comprueba su **forma**: la confianza la dan los verificadores contra
 * `local_trust_anchor`, que es la única autoridad, y este módulo no la
 * sustituye ni la adelanta.
 *
 * Por eso `ABSENT` e `INVALID` son desenlaces distintos y se tratan distinto en
 * el arranque: ausente es un equipo sin aprovisionar —estado normal—, e
 * inválido es un fichero que alguien tocó. Confundirlos convertiría un fichero
 * manipulable en una forma de dejar el equipo sin sesión, o peor, de instalarle
 * una.
 */
export type OperatorSessionArtifactRead =
  | { readonly decision: "PRESENT"; readonly artifact: OperatorSessionProvisioningArtifact }
  | { readonly decision: "ABSENT" }
  | { readonly decision: "INVALID"; readonly reason: string };

export function readOperatorSessionArtifact(path: string): OperatorSessionArtifactRead {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { decision: "ABSENT" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { decision: "INVALID", reason: "ARTIFACT_NOT_JSON" };
  }

  const result = OperatorSessionProvisioningArtifactSchema.safeParse(parsed);
  if (!result.success) {
    // Nunca el detalle del error: puede transportar fragmentos del artefacto.
    return { decision: "INVALID", reason: "ARTIFACT_SHAPE_INVALID" };
  }
  return { decision: "PRESENT", artifact: result.data };
}

/**
 * El `SnapshotProvider` que el seam de `SAS-003` dejó abierto, servido desde el
 * artefacto en vez de por red.
 *
 * `snapshot-provider.ts` anticipaba «la implementación HTTP se conectará aquí
 * sin tocar el servicio de adquisición». Ésta es la de fichero, y cuando exista
 * el emisor central se sustituye por la de red sin mover nada más: la ruta de
 * consumo sigue siendo la canónica, que es lo que hace que este bootstrap no
 * sea deuda estructural.
 *
 * `fetch` **lanza** cuando no hay artefacto, que es el contrato del puerto: el
 * llamador lo traduce a `PROVIDER_UNAVAILABLE` y conserva intacto el snapshot
 * local previo.
 */
export class ArtifactSnapshotProvider implements SnapshotProvider {
  constructor(private readonly artifact: OperatorSessionProvisioningArtifact) {}

  fetch(_binding: SnapshotBinding): Promise<OperatorSessionProvisioningArtifact["authorization_snapshot"]> {
    return Promise.resolve(this.artifact.authorization_snapshot);
  }
}

/**
 * Activa los dos sobres de un artefacto de sesión de operador por la ruta
 * canónica: la SSA por `SessionActivationService` y el SAS por
 * `SnapshotAcquisitionService` contra el ancla de `AUTHORIZATION_SNAPSHOT`.
 *
 * Es el bloque que el arranque de `DEC-025` ya ejecutaba en `main.ts`,
 * extraído sin cambiar su orden ni sus desenlaces para que el login
 * (`session.login`, `DEC-026` §13.11) use **exactamente** la misma ruta: un
 * artefacto venga de fichero o de la autoridad central, se verifica igual.
 *
 * Orden y razón, como estaban: si la SSA no verifica no se intenta el SAS —una
 * sesión sin permisos arrancaría el POS para rechazarlo todo—.
 */
export interface OperatorSessionActivationDependencies {
  readonly sessionActivation: {
    activate(
      signed: OperatorSessionProvisioningArtifact["session_assertion"],
      binding: { readonly userId: string; readonly installationId: string; readonly deviceId: string },
    ): { readonly kind: string; readonly decision?: string };
  };
  readonly authorizationSnapshotKeys: ConstructorParameters<typeof AuthorizationSnapshotVerifier>[0];
  readonly trustedClock: ConstructorParameters<typeof AuthorizationSnapshotVerifier>[1];
  readonly authorizationStore: ConstructorParameters<typeof SnapshotAcquisitionService>[2];
  readonly installationId: string;
  readonly deviceId: string;
}

export type OperatorSessionActivation =
  | { readonly decision: "PROVISIONED" }
  | { readonly decision: "SESSION_REJECTED"; readonly detail: string }
  | { readonly decision: "SNAPSHOT_REJECTED"; readonly detail: string };

export async function activateOperatorSessionArtifact(
  artifact: OperatorSessionProvisioningArtifact,
  dependencies: OperatorSessionActivationDependencies,
): Promise<OperatorSessionActivation> {
  const binding = {
    userId: artifact.session_assertion.claims.user_id,
    installationId: dependencies.installationId,
    deviceId: dependencies.deviceId,
  };

  const activation = dependencies.sessionActivation.activate(artifact.session_assertion, binding);
  if (activation.kind !== "ACTIVATED") {
    // `REJECTED` a secas no dice nada: es el nombre del desenlace, no su
    // causa. Se emite la decisión del verificador, que es el dato que
    // distingue «firma que no cuadra» de «SSA vencida» o «binding de otro
    // equipo».
    return {
      decision: "SESSION_REJECTED",
      detail: activation.kind === "REJECTED" && activation.decision !== undefined ? activation.decision : activation.kind,
    };
  }

  const acquisition = await new SnapshotAcquisitionService(
    new ArtifactSnapshotProvider(artifact),
    new AuthorizationSnapshotVerifier(dependencies.authorizationSnapshotKeys, dependencies.trustedClock),
    dependencies.authorizationStore,
  ).acquire(binding);
  if (acquisition.kind !== "ACQUIRED") {
    return { decision: "SNAPSHOT_REJECTED", detail: acquisition.kind };
  }
  return { decision: "PROVISIONED" };
}

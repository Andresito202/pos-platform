import { createHash } from "node:crypto";
import { classifyIdempotency } from "@pos-platform/contracts";
import { uuidV7, type SqlQueryExecutor, type TransactionalSql } from "../sql.js";

/**
 * `ONB-002` — materialización física del bootstrap transaccional que
 * `UC-ONB-001` §374 define.
 *
 * ## Qué materializa y qué no puede redefinir
 *
 * `UC-ONB-001` fija el contrato funcional; este módulo lo ejecuta contra el
 * esquema real de `001_central_foundation` y no altera ninguno de sus
 * invariantes: una sola transacción, rollback total ante fallo previo al
 * commit, idempotencia por clave y checksum, y ningún tenant parcialmente
 * visible.
 *
 * ## La idempotencia es física, no una comprobación previa
 *
 * El contrato (§401 regla 6) prohíbe que una `idempotency_key` produzca dos
 * tenants lógicos. Un `if (!existe) inserta()` no lo garantiza bajo
 * concurrencia: dos transacciones pueden leer «no existe» a la vez. Aquí la
 * garantía es la restricción `onboarding_operations_identity_uq
 * (actor_type, actor_id, idempotency_key)` del propio esquema: la primera
 * sentencia de la transacción es el `INSERT … ON CONFLICT DO NOTHING` sobre
 * esa clave, de modo que el perdedor de una carrera no crea nada y lee el
 * resultado del ganador. La comprobación de duplicidad y la inserción
 * comparten transacción, como exige §374 regla 4.
 *
 * ## Orden de persistencia
 *
 * Lo imponen las claves ajenas del esquema, no una preferencia:
 * operación → usuario → tenant → company → branch → membership →
 * role assignment → auditoría → outbox → resultado.
 *
 * ## Lo que deliberadamente NO hace
 *
 * **No emite licencia ni registra dispositivo.** `UC-ONB-001` §374 regla 6
 * lo prohíbe expresamente —«no se simula una transacción distribuida»— y
 * regla 7 autoriza terminar en `READY_FOR_LICENSE`. Ése es el estado
 * terminal de esta operación cuando no hay licencia aplicable, y no significa
 * habilitado para operar el POS.
 *
 * **No concede permisos por ser propietario.** §112 regla 6: la pertenencia
 * `OWNER` no otorga por sí sola ningún permiso. El rol entra por
 * `UserRoleAssignment` explícita contra un rol que debe existir en
 * `"authorization".roles`; si no existe, el onboarding falla en vez de
 * inventar autorización.
 */

export type OnboardingActorType = "USER" | "PLATFORM_ACCOUNT";

export interface InitializeTenantRequest {
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly actorType: OnboardingActorType;
  readonly actorId: string;
  readonly owner: {
    readonly email: string;
    readonly fullName: string;
    readonly phone?: string | null;
  };
  readonly tenant: { readonly name: string; readonly code?: string | null };
  readonly company: {
    readonly tradeName: string;
    readonly legalName?: string | null;
    readonly taxId?: string | null;
    readonly timezone: string;
    readonly currencyCode: string;
  };
  readonly branch: {
    readonly name: string;
    readonly code?: string | null;
    readonly timezone: string;
  };
  /** Código del rol de negocio a asignar al propietario. Debe existir. */
  readonly ownerRoleCode: string;
  readonly requestedPlan?: string | null;
}

export interface OnboardingIdentifiers {
  readonly onboardingId: string;
  readonly tenantId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly ownerUserId: string;
  readonly tenantMembershipId: string;
  readonly userRoleAssignmentId: string;
}

export type InitializeTenantOutcome =
  | { readonly kind: "INITIALIZED"; readonly status: "READY_FOR_LICENSE"; readonly identifiers: OnboardingIdentifiers; readonly ownerCreated: boolean }
  | { readonly kind: "IDEMPOTENT"; readonly status: string; readonly identifiers: OnboardingIdentifiers }
  | { readonly kind: "IDEMPOTENCY_CONFLICT"; readonly onboardingId: string }
  | { readonly kind: "OWNER_ROLE_NOT_FOUND"; readonly roleCode: string }
  | { readonly kind: "COMMERCIAL_IDENTITY_TAKEN"; readonly taxId: string };

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/** Sólo dígitos: un NIT no cambia de identidad por llevar puntos o guiones. */
function normalizeTaxId(value: string): string {
  return value.replace(/[^0-9a-zA-Z]/g, "").toUpperCase();
}

/**
 * Huella de la intención comercial. Cubre exactamente lo que define la
 * operación: repetir la misma intención debe dar el mismo checksum, y
 * cambiar cualquier dato de negocio debe producir conflicto en vez de mutar
 * el tenant ya creado (`UC-ONB-001` §374 regla 3).
 */
export function initializeTenantChecksum(request: InitializeTenantRequest): string {
  return createHash("sha256").update(JSON.stringify({
    actor_id: request.actorId,
    actor_type: request.actorType,
    branch_code: request.branch.code ?? null,
    branch_name: request.branch.name,
    branch_timezone: request.branch.timezone,
    company_currency: request.company.currencyCode,
    company_legal_name: request.company.legalName ?? null,
    company_tax_id: request.company.taxId === undefined || request.company.taxId === null
      ? null
      : normalizeTaxId(request.company.taxId),
    company_timezone: request.company.timezone,
    company_trade_name: request.company.tradeName,
    idempotency_key: request.idempotencyKey,
    owner_email: normalize(request.owner.email),
    owner_full_name: request.owner.fullName,
    owner_role_code: request.ownerRoleCode,
    requested_plan: request.requestedPlan ?? null,
    tenant_code: request.tenant.code ?? null,
    tenant_name: request.tenant.name,
  })).digest("hex");
}

interface OnboardingRow {
  id: string;
  request_checksum: string;
  status: string;
  tenant_id: string | null;
  company_id: string | null;
  branch_id: string | null;
  owner_user_id: string | null;
  tenant_membership_id: string | null;
}

function identifiersOf(row: OnboardingRow): OnboardingIdentifiers | null {
  if (row.tenant_id === null || row.company_id === null || row.branch_id === null
    || row.owner_user_id === null || row.tenant_membership_id === null) {
    return null;
  }
  return {
    onboardingId: row.id,
    tenantId: row.tenant_id,
    companyId: row.company_id,
    branchId: row.branch_id,
    ownerUserId: row.owner_user_id,
    tenantMembershipId: row.tenant_membership_id,
    userRoleAssignmentId: "",
  };
}

/**
 * Un asiento de auditoría por efecto crítico (`UC-ONB-001` §419).
 *
 * `payload_checksum` cubre el valor nuevo, no el payload de la petición:
 * la auditoría prueba qué quedó escrito. Nunca entra un secreto —el contrato
 * no los tiene: aquí no viajan credenciales ni material criptográfico.
 *
 * El sello se calcula **en el servidor sobre el `jsonb` ya normalizado**, no
 * en el cliente sobre el texto enviado. `jsonb` reordena claves y descarta
 * espacios al almacenar, de modo que un sello del texto original no podría
 * re-derivarse nunca desde la fila: sería un número imposible de verificar.
 * Así, cualquiera puede recalcularlo con `sha256(new_value::text)`.
 *
 * `operation_id` va **siempre nulo**, y no por omisión:
 * `audit_events_operation_fk` lo liga a `sync.sync_operations(tenant_id, id)`,
 * de modo que sólo admite la identidad de una operación de sincronización.
 * Un onboarding no lo es. Lo que hila los asientos entre sí es
 * `correlation_id`, y el onboarding se nombra en `resource_id`, que es
 * exactamente lo que pide `UC-ONB-001` §419.
 */
async function audit(
  tx: SqlQueryExecutor,
  input: {
    at: string; actorType: string; actorId: string; correlationId: string;
    onboardingId: string; tenantId: string | null; companyId: string | null; branchId: string | null;
    actionCode: string; resourceType: string; resourceId: string;
    newValue: Record<string, unknown>;
  },
): Promise<void> {
  const payload = JSON.stringify(input.newValue);
  await tx.query(
    `INSERT INTO audit.audit_events(
       id, tenant_id, company_id, branch_id, actor_type, actor_id, session_id, device_id,
       action_code, resource_type, resource_reference_kind, resource_id, operation_id,
       correlation_id, causation_id, schema_version, reported_at, server_recorded_at,
       result, reason_code, reason_detail, previous_value, new_value, payload_checksum
     ) VALUES ($1,$2,$3,$4,$5,$6,NULL,NULL,$7,$8,'INSTANCE',$9,NULL,$10,NULL,1,$11,$11,
               'SUCCEEDED',NULL,NULL,NULL,$12::jsonb,
               encode(sha256(convert_to($12::jsonb::text, 'UTF8')), 'hex'))`,
    [
      uuidV7(), input.tenantId, input.companyId, input.branchId,
      input.actorType, input.actorId,
      input.actionCode, input.resourceType, input.resourceId,
      input.correlationId, input.at, payload,
    ],
  );
}

export class InitializeTenantUseCase {
  constructor(
    private readonly sql: TransactionalSql,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(request: InitializeTenantRequest): Promise<InitializeTenantOutcome> {
    const checksum = initializeTenantChecksum(request);

    return this.sql.withTransaction(async (tx): Promise<InitializeTenantOutcome> => {
      const at = this.now().toISOString();
      const onboardingId = uuidV7(this.now());

      // 1 · La operación primero. El `ON CONFLICT` sobre la restricción de
      //     identidad es la protección física de concurrencia: el perdedor
      //     de la carrera no inserta y sigue por la rama idempotente.
      const claimed = await tx.query<{ id: string }>(
        `INSERT INTO tenancy.onboarding_operations(
           id, actor_type, actor_id, idempotency_key, request_checksum, correlation_id,
           status, requested_plan, created_at, updated_at, version
         ) VALUES ($1,$2,$3,$4,$5,$6,'PENDING',$7,$8,$8,1)
         ON CONFLICT ON CONSTRAINT onboarding_operations_identity_uq DO NOTHING
         RETURNING id`,
        [onboardingId, request.actorType, request.actorId, request.idempotencyKey,
          checksum, request.correlationId, request.requestedPlan ?? null, at],
      );

      if (claimed.length === 0) {
        const [existing] = await tx.query<OnboardingRow>(
          `SELECT id, request_checksum, status, tenant_id, company_id, branch_id,
                  owner_user_id, tenant_membership_id
             FROM tenancy.onboarding_operations
            WHERE actor_type=$1 AND actor_id=$2 AND idempotency_key=$3`,
          [request.actorType, request.actorId, request.idempotencyKey],
        );
        if (existing === undefined) throw new Error("onboarding identity vanished inside its own transaction");

        // La clasificación la hace el contrato compartido, no una comparación
        // propia: `classifyIdempotency` es la única definición de REPLAY y
        // CONFLICT del repositorio, y duplicarla aquí habría creado una
        // segunda semántica de idempotencia para el plano central.
        //
        // Ambas identidades llevan el `operation_id` de la fila existente
        // porque eso es lo que se está comparando: la misma operación ya
        // reclamada frente a la intención que llega. Lo que decide es el
        // checksum.
        const decision = classifyIdempotency(
          {
            operation_id: existing.id,
            idempotency_key: request.idempotencyKey,
            payload_checksum: existing.request_checksum,
          },
          {
            operation_id: existing.id,
            idempotency_key: request.idempotencyKey,
            payload_checksum: checksum,
          },
        );
        // Misma clave con otro checksum: conflicto estable. No se toca el
        // onboarding original (`UC-ONB-001` §374 regla 3).
        if (decision === "CONFLICT") {
          return { kind: "IDEMPOTENCY_CONFLICT", onboardingId: existing.id };
        }
        const identifiers = identifiersOf(existing);
        if (identifiers === null) throw new Error("idempotent onboarding has no structural result");
        const [assignment] = await tx.query<{ id: string }>(
          `SELECT id FROM "authorization".user_role_assignments
            WHERE tenant_id=$1 AND tenant_membership_id=$2 ORDER BY created_at LIMIT 1`,
          [identifiers.tenantId, identifiers.tenantMembershipId],
        );
        return {
          kind: "IDEMPOTENT",
          status: existing.status,
          identifiers: { ...identifiers, userRoleAssignmentId: assignment?.id ?? "" },
        };
      }

      // 2 · El rol debe existir antes de crear nada: sin autorización válida
      //     no hay onboarding (`UC-ONB-001` §112 regla 10).
      const [role] = await tx.query<{ id: string }>(
        `SELECT id FROM "authorization".roles
          WHERE code=$1 AND status='ACTIVE' AND scope_type='BUSINESS'
          ORDER BY version DESC LIMIT 1`,
        [request.ownerRoleCode],
      );
      if (role === undefined) return { kind: "OWNER_ROLE_NOT_FOUND", roleCode: request.ownerRoleCode };

      // 3 · Identidad comercial: un NIT ya usado por otro tenant no se
      //     reutiliza en silencio (`UC-ONB-001` §94 paso 2).
      const taxIdNormalized = request.company.taxId === undefined || request.company.taxId === null
        ? null
        : normalizeTaxId(request.company.taxId);
      if (taxIdNormalized !== null) {
        const [taken] = await tx.query<{ tenant_id: string }>(
          "SELECT tenant_id FROM organization.companies WHERE tax_id_normalized=$1 LIMIT 1",
          [taxIdNormalized],
        );
        if (taken !== undefined) return { kind: "COMMERCIAL_IDENTITY_TAKEN", taxId: taxIdNormalized };
      }

      // 4 · El propietario: se reutiliza determinísticamente por correo
      //     normalizado, o se crea exactamente una identidad.
      const emailNormalized = normalize(request.owner.email);
      const inserted = await tx.query<{ id: string }>(
        `INSERT INTO identity.users(
           id, email, email_normalized, phone, phone_normalized, full_name, status,
           created_at, updated_at, version
         ) VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',$7,$7,1)
         ON CONFLICT ON CONSTRAINT users_email_normalized_uq DO NOTHING
         RETURNING id`,
        [uuidV7(this.now()), request.owner.email.trim(), emailNormalized,
          request.owner.phone ?? null,
          request.owner.phone === undefined || request.owner.phone === null ? null : normalize(request.owner.phone),
          request.owner.fullName.trim(), at],
      );
      const ownerCreated = inserted.length > 0;
      const ownerUserId = ownerCreated
        ? inserted[0]!.id
        : (await tx.query<{ id: string }>(
          "SELECT id FROM identity.users WHERE email_normalized=$1", [emailNormalized],
        ))[0]!.id;

      // 5 · Estructura. El orden lo imponen las claves ajenas.
      const tenantId = uuidV7(this.now());
      await tx.query(
        `INSERT INTO tenancy.tenants(id, name, code, code_normalized, status, created_at, updated_at, version)
         VALUES ($1,$2,$3,$4,'ACTIVE',$5,$5,1)`,
        [tenantId, request.tenant.name.trim(), request.tenant.code ?? null,
          request.tenant.code === undefined || request.tenant.code === null ? null : normalize(request.tenant.code), at],
      );

      const companyId = uuidV7(this.now());
      await tx.query(
        `INSERT INTO organization.companies(
           id, tenant_id, legal_name, trade_name, tax_id, tax_id_normalized,
           email, phone, phone_normalized, timezone, currency_code, status,
           created_at, updated_at, version
         ) VALUES ($1,$2,$3,$4,$5,$6,NULL,NULL,NULL,$7,$8,'ACTIVE',$9,$9,1)`,
        [companyId, tenantId, request.company.legalName ?? null, request.company.tradeName.trim(),
          request.company.taxId ?? null, taxIdNormalized,
          request.company.timezone, request.company.currencyCode, at],
      );

      const branchId = uuidV7(this.now());
      await tx.query(
        `INSERT INTO organization.branches(
           id, tenant_id, company_id, name, code, code_normalized, address, city,
           latitude, longitude, timezone, status, created_at, updated_at, version
         ) VALUES ($1,$2,$3,$4,$5,$6,NULL,NULL,NULL,NULL,$7,'ACTIVE',$8,$8,1)`,
        [branchId, tenantId, companyId, request.branch.name.trim(), request.branch.code ?? null,
          request.branch.code === undefined || request.branch.code === null ? null : normalize(request.branch.code),
          request.branch.timezone, at],
      );

      // 6 · La relación propietario ↔ tenant, explícita y con su tenant
      //     dentro (`UC-ONB-001` §401 regla 3).
      //
      //     `is_primary` se deriva, no se fija: `tenant_memberships_primary_active_uq`
      //     admite **una sola** pertenencia primaria activa por usuario, de
      //     modo que sólo la primera del propietario puede serlo. Un mismo
      //     dueño con dos comercios es el caso normal y §112 regla 5 lo
      //     admite —ser propietario de uno no da acceso al otro—: marcarlas
      //     todas primarias haría fallar el segundo onboarding.
      const membershipId = uuidV7(this.now());
      const [primaryHeld] = await tx.query<{ exists: boolean }>(
        `SELECT EXISTS(
           SELECT 1 FROM tenancy.tenant_memberships
            WHERE user_id=$1 AND is_primary AND status='ACTIVE'
         ) AS exists`,
        [ownerUserId],
      );
      await tx.query(
        `INSERT INTO tenancy.tenant_memberships(
           id, tenant_id, user_id, membership_type, status, is_primary,
           created_by_actor_type, created_by_actor_id, created_at, activated_at, version
         ) VALUES ($1,$2,$3,'OWNER','ACTIVE',$4,$5,$6,$7,$7,1)`,
        [membershipId, tenantId, ownerUserId, primaryHeld?.exists !== true,
          request.actorType, request.actorId, at],
      );

      // 7 · Los permisos entran por asignación de rol, no por ser propietario.
      const assignmentId = uuidV7(this.now());
      await tx.query(
        `INSERT INTO "authorization".user_role_assignments(
           id, tenant_id, tenant_membership_id, role_id, company_id, branch_id,
           status, valid_from, valid_until, created_at,
           created_by_actor_type, created_by_actor_id, revoked_at, version
         ) VALUES ($1,$2,$3,$4,$5,NULL,'ACTIVE',$6,NULL,$6,$7,$8,NULL,1)`,
        [assignmentId, tenantId, membershipId, role.id, companyId, at,
          request.actorType, request.actorId],
      );

      // 8 · Auditoría de cada efecto crítico.
      const base = {
        at, actorType: request.actorType, actorId: request.actorId,
        correlationId: request.correlationId, onboardingId,
      };
      await audit(tx, { ...base, tenantId: null, companyId: null, branchId: null,
        actionCode: "ONBOARDING_STARTED", resourceType: "ONBOARDING_OPERATION", resourceId: onboardingId,
        newValue: { status: "PENDING", idempotency_key: request.idempotencyKey } });
      await audit(tx, { ...base, tenantId, companyId: null, branchId: null,
        actionCode: "TENANT_CREATED", resourceType: "TENANT", resourceId: tenantId,
        newValue: { name: request.tenant.name, status: "ACTIVE" } });
      await audit(tx, { ...base, tenantId, companyId, branchId: null,
        actionCode: "COMPANY_CREATED", resourceType: "COMPANY", resourceId: companyId,
        newValue: { trade_name: request.company.tradeName, currency_code: request.company.currencyCode } });
      await audit(tx, { ...base, tenantId, companyId, branchId,
        actionCode: "BRANCH_CREATED", resourceType: "BRANCH", resourceId: branchId,
        newValue: { name: request.branch.name, timezone: request.branch.timezone } });
      await audit(tx, { ...base, tenantId, companyId: null, branchId: null,
        actionCode: "TENANT_OWNER_ASSIGNED", resourceType: "TENANT_MEMBERSHIP", resourceId: membershipId,
        newValue: { membership_type: "OWNER", owner_user_id: ownerUserId, owner_created: ownerCreated } });
      await audit(tx, { ...base, tenantId, companyId, branchId: null,
        actionCode: "OWNER_ROLE_ASSIGNED", resourceType: "USER_ROLE_ASSIGNMENT", resourceId: assignmentId,
        newValue: { role_code: request.ownerRoleCode, scope_company_id: companyId } });

      // 9 · Outbox dentro de la misma transacción: un rollback no puede dejar
      //     un evento anunciando un tenant que no existe.
      //
      //     `outbox_entries_operation_fk` obliga a que la entrada cuelgue de
      //     una `sync.sync_operations`, así que el hecho se escribe primero y
      //     la entrada después. No es burocracia: la operación guarda el
      //     payload canónico y la entrada sólo su despacho, que es la misma
      //     separación que el outbox local mantiene. `source_kind` sólo
      //     admite `CENTRAL_SERVICE` y el perfil central exige dispositivo e
      //     instalación nulos — un onboarding encaja exactamente ahí.
      const outboxOperationId = uuidV7(this.now());
      const outboxPayload = JSON.stringify({
        onboarding_id: onboardingId, tenant_id: tenantId, company_id: companyId,
        branch_id: branchId, owner_user_id: ownerUserId, status: "READY_FOR_LICENSE",
      });
      const outboxChecksum = createHash("sha256").update(outboxPayload).digest();
      await tx.query(
        `INSERT INTO sync.sync_operations(
           id, tenant_id, company_id, branch_id, source_kind, device_id, installation_id,
           session_id, actor_type, actor_id, aggregate_type, aggregate_id, operation_type,
           idempotency_key, expected_version, authority_policy, parent_operation_id,
           causation_id, correlation_id, schema_version, payload, payload_checksum,
           sync_status, occurred_at_local, recorded_at_local, received_at_server,
           committed_at_server, version
         ) VALUES ($1,$2,$3,$4,'CENTRAL_SERVICE',NULL,NULL,NULL,$5,$6,'TENANT',$2,
                   'TENANT_ONBOARDED',$7,NULL,'SERVER_AUTHORITATIVE',NULL,NULL,$8,1,
                   $9::jsonb,$10,'READY_TO_SYNC',NULL,NULL,$11,$11,1)`,
        [outboxOperationId, tenantId, companyId, branchId,
          request.actorType, request.actorId, request.idempotencyKey,
          request.correlationId, outboxPayload, outboxChecksum, at],
      );
      await tx.query(
        `INSERT INTO sync.outbox_entries(
           id, tenant_id, operation_id, device_id, local_sequence, operation_type,
           schema_version, payload_checksum, correlation_id, causation_id, sync_status,
           created_at, available_at, attempt_count, updated_at, version
         ) VALUES ($1,$2,$3,NULL,NULL,'TENANT_ONBOARDED',1,$4,$5,NULL,'READY_TO_SYNC',$6,$6,0,$6,1)`,
        [uuidV7(this.now()), tenantId, outboxOperationId, outboxChecksum,
          request.correlationId, at],
      );

      // 10 · El resultado idempotente. `READY_FOR_LICENSE` y no `COMPLETED`:
      //      la licencia la emite otra autoridad, después, por una operación
      //      separada (`UC-ONB-001` §374 reglas 6 y 7).
      await tx.query(
        `UPDATE tenancy.onboarding_operations
            SET tenant_id=$1, company_id=$2, branch_id=$3, owner_user_id=$4,
                tenant_membership_id=$5, status='READY_FOR_LICENSE',
                updated_at=$6, version=version+1
          WHERE id=$7`,
        [tenantId, companyId, branchId, ownerUserId, membershipId, at, onboardingId],
      );
      await audit(tx, { ...base, tenantId, companyId, branchId,
        actionCode: "ONBOARDING_STATUS_CHANGED", resourceType: "ONBOARDING_OPERATION", resourceId: onboardingId,
        newValue: { previous_status: "PENDING", status: "READY_FOR_LICENSE" } });

      return {
        kind: "INITIALIZED",
        status: "READY_FOR_LICENSE",
        ownerCreated,
        identifiers: {
          onboardingId, tenantId, companyId, branchId,
          ownerUserId, tenantMembershipId: membershipId, userRoleAssignmentId: assignmentId,
        },
      };
    });
  }
}

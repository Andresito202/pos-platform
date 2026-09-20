import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  InitializeTenantUseCase,
  initializeTenantChecksum,
  uuidV7,
  type InitializeTenantRequest,
  type SqlQueryExecutor,
  type TransactionalSql,
} from "../src/index.js";

/**
 * `ONB-002` contra PostgreSQL **real**, con el esquema central real.
 *
 * No hay dobles de base de datos: la suite aplica
 * `001_central_foundation.up.sql` sobre un servidor vivo y ejecuta el caso de
 * uso contra él. Todo lo que este archivo afirma —atomicidad, idempotencia,
 * concurrencia, aislamiento— lo decide PostgreSQL con sus propias
 * restricciones, no una simulación.
 *
 * `POSTGRES_TEST_URL` apunta al servidor, igual que en
 * `tools/target-migrations`. Sin servidor, la suite falla: no se salta.
 *
 * ## Por qué no hay limpieza entre pruebas
 *
 * No es descuido. `audit.audit_events` y `identity.security_events` llevan
 * guarda append-only **de fila y de TRUNCATE**
 * (`audit.reject_append_only_mutation`), de modo que borrarlas es imposible
 * por diseño; y como la auditoría referencia tenants y empresas, tampoco se
 * pueden borrar los padres. Vaciar el esquema exigiría desactivar un trigger
 * de integridad en una prueba, que es exactamente lo que este repositorio no
 * hace.
 *
 * Así que cada prueba trae su propia identidad —clave de idempotencia,
 * correo del propietario y NIT— y **toda aserción está acotada** a su tenant
 * o a su correlación. Es además más fiel: una base central real tampoco se
 * vacía entre onboardings.
 */

const SERVER_URL = process.env["POSTGRES_TEST_URL"] ?? "postgres://postgres@127.0.0.1:55432/postgres";
const DATABASE = "pos_onb002";
const DATABASE_URL = SERVER_URL.replace(/\/[^/]*$/, `/${DATABASE}`);

let pool: Pool;

/** Adaptador `pg` del puerto. Es infraestructura de prueba, no del paquete. */
function transactional(target: Pool): TransactionalSql {
  return {
    async withTransaction<T>(run: (tx: SqlQueryExecutor) => Promise<T>): Promise<T> {
      const client = await target.connect();
      try {
        await client.query("BEGIN");
        const executor: SqlQueryExecutor = {
          async query<R>(text: string, params: readonly unknown[] = []) {
            return (await client.query(text, [...params])).rows as R[];
          },
        };
        const result = await run(executor);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

const NOW = new Date("2026-09-20T12:00:00.000Z");
const OWNER_ROLE = "TENANT_OWNER";
const ACTOR = uuidV7(NOW);

let sequence = 0;
/** Identidad propia por prueba: sin limpieza, la unicidad la da el caso. */
function unique(): string {
  sequence += 1;
  return `c${String(sequence).padStart(3, "0")}`;
}

function request(id: string, overrides: Partial<InitializeTenantRequest> = {}): InitializeTenantRequest {
  return {
    idempotencyKey: `onboarding:${id}`,
    correlationId: uuidV7(NOW),
    actorType: "PLATFORM_ACCOUNT",
    actorId: ACTOR,
    owner: { email: `Duenio.${id}@Acme.CO`, fullName: "Dueño Acme" },
    tenant: { name: `Acme Retail ${id}` },
    company: {
      tradeName: `Acme Tienda ${id}`, legalName: "Acme S.A.S.",
      taxId: `900.${id.slice(1)}.456-7`,
      timezone: "America/Bogota", currencyCode: "COP",
    },
    branch: { name: "Sede Centro", timezone: "America/Bogota" },
    ownerRoleCode: OWNER_ROLE,
    ...overrides,
  };
}

async function count(sql: string, params: readonly unknown[] = []): Promise<number> {
  return Number((await pool.query(sql, [...params])).rows[0].n);
}

beforeAll(async () => {
  const admin = new Pool({ connectionString: SERVER_URL });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${DATABASE} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${DATABASE}`);
  } finally {
    await admin.end();
  }

  pool = new Pool({ connectionString: DATABASE_URL });
  const { readFile } = await import("node:fs/promises");
  const { fileURLToPath } = await import("node:url");
  const { dirname, join } = await import("node:path");
  const here = dirname(fileURLToPath(import.meta.url));
  const sqlRoot = join(here, "..", "..", "..", "tools", "target-migrations", "sql", "postgres");
  await pool.query(await readFile(join(sqlRoot, "bootstrap.sql"), "utf8"));
  await pool.query(await readFile(join(sqlRoot, "001_central_foundation.up.sql"), "utf8"));
  await pool.query(
    `INSERT INTO "authorization".roles(id, code, name, scope_type, version, status, created_at)
     VALUES ($1,$2,'Propietario del comercio','BUSINESS',1,'ACTIVE',$3)`,
    [uuidV7(NOW), OWNER_ROLE, NOW.toISOString()],
  );
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

function useCase(): InitializeTenantUseCase {
  return new InitializeTenantUseCase(transactional(pool), () => NOW);
}

// ── A · Onboarding válido y su rastro completo ───────────────────────────────

describe("ONB-002 — bootstrap transaccional", () => {
  it("crea tenant, empresa, sucursal, propietario, membership y rol en una transacción", async () => {
    const outcome = await useCase().execute(request(unique()));
    if (outcome.kind !== "INITIALIZED") throw new Error(`expected INITIALIZED, got ${outcome.kind}`);

    expect(outcome.status).toBe("READY_FOR_LICENSE");
    expect(outcome.ownerCreated).toBe(true);
    const ids = outcome.identifiers;

    const company = (await pool.query(
      "SELECT tenant_id, tax_id_normalized FROM organization.companies WHERE id=$1", [ids.companyId],
    )).rows[0];
    expect(company.tenant_id).toBe(ids.tenantId);
    // El NIT se normaliza: puntos y guiones no cambian la identidad comercial.
    expect(company.tax_id_normalized).toMatch(/^900\d+4567$/);

    const branch = (await pool.query(
      "SELECT tenant_id, company_id FROM organization.branches WHERE id=$1", [ids.branchId],
    )).rows[0];
    expect(branch.tenant_id).toBe(ids.tenantId);
    expect(branch.company_id).toBe(ids.companyId);

    // El propietario es una relación física, no un correo.
    const membership = (await pool.query(
      "SELECT tenant_id, user_id, membership_type, status FROM tenancy.tenant_memberships WHERE id=$1",
      [ids.tenantMembershipId],
    )).rows[0];
    expect(membership).toMatchObject({
      tenant_id: ids.tenantId, user_id: ids.ownerUserId,
      membership_type: "OWNER", status: "ACTIVE",
    });

    // Y los permisos llegan por asignación explícita, no por ser propietario.
    const assignment = (await pool.query(
      `SELECT tenant_id, tenant_membership_id, company_id, status
         FROM "authorization".user_role_assignments WHERE id=$1`,
      [ids.userRoleAssignmentId],
    )).rows[0];
    expect(assignment).toMatchObject({
      tenant_id: ids.tenantId, tenant_membership_id: ids.tenantMembershipId,
      company_id: ids.companyId, status: "ACTIVE",
    });

    // El correo se normaliza: la identidad global no depende de mayúsculas.
    const owner = (await pool.query(
      "SELECT email, email_normalized FROM identity.users WHERE id=$1", [ids.ownerUserId],
    )).rows[0];
    expect(owner.email_normalized).toBe(owner.email.toLowerCase());
  });

  it("reutiliza un propietario existente sin crear una segunda identidad", async () => {
    const id = unique();
    const base = request(id);
    const email = base.owner.email.toLowerCase();
    await pool.query(
      `INSERT INTO identity.users(id, email, email_normalized, phone, phone_normalized,
         full_name, status, created_at, updated_at, version)
       VALUES ($1,$2,$2,NULL,NULL,'Dueño Previo','ACTIVE',$3,$3,1)`,
      [uuidV7(NOW), email, NOW.toISOString()],
    );

    const outcome = await useCase().execute(base);
    if (outcome.kind !== "INITIALIZED") throw new Error("expected INITIALIZED");
    expect(outcome.ownerCreated).toBe(false);
    expect(await count(
      "SELECT COUNT(*) AS n FROM identity.users WHERE email_normalized=$1", [email],
    )).toBe(1);
  });

  it("registra auditoría de cada efecto crítico y una entrada de outbox", async () => {
    const base = request(unique());
    const outcome = await useCase().execute(base);
    if (outcome.kind !== "INITIALIZED") throw new Error("expected INITIALIZED");

    const actions = (await pool.query(
      "SELECT action_code FROM audit.audit_events WHERE correlation_id=$1 ORDER BY action_code",
      [base.correlationId],
    )).rows.map((row: { action_code: string }) => row.action_code);
    expect(actions).toEqual([
      "BRANCH_CREATED", "COMPANY_CREATED", "ONBOARDING_STARTED",
      "ONBOARDING_STATUS_CHANGED", "OWNER_ROLE_ASSIGNED", "TENANT_CREATED",
      "TENANT_OWNER_ASSIGNED",
    ]);

    const outbox = (await pool.query(
      "SELECT tenant_id, operation_type, sync_status, device_id, local_sequence FROM sync.outbox_entries WHERE tenant_id=$1",
      [outcome.identifiers.tenantId],
    )).rows;
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      tenant_id: outcome.identifiers.tenantId,
      operation_type: "TENANT_ONBOARDED",
      sync_status: "READY_TO_SYNC",
      device_id: null, local_sequence: null,
    });

    // La entrada cuelga de una operación central, no de un dispositivo.
    const operation = (await pool.query(
      "SELECT source_kind, authority_policy, device_id FROM sync.sync_operations WHERE tenant_id=$1",
      [outcome.identifiers.tenantId],
    )).rows[0];
    expect(operation).toMatchObject({
      source_kind: "CENTRAL_SERVICE", authority_policy: "SERVER_AUTHORITATIVE", device_id: null,
    });
  });

  it("no crea licencia ni dispositivo: el estado terminal es READY_FOR_LICENSE", async () => {
    const outcome = await useCase().execute(request(unique()));
    if (outcome.kind !== "INITIALIZED") throw new Error("expected INITIALIZED");

    const row = (await pool.query(
      `SELECT status, license_reference, effective_plan, completed_at
         FROM tenancy.onboarding_operations WHERE id=$1`,
      [outcome.identifiers.onboardingId],
    )).rows[0];
    // `UC-ONB-001` §374 regla 6: la licencia la emite otra autoridad, después.
    expect(row).toMatchObject({
      status: "READY_FOR_LICENSE", license_reference: null,
      effective_plan: null, completed_at: null,
    });
  });
});

// ── B · Idempotencia ─────────────────────────────────────────────────────────

describe("ONB-002 — idempotencia", () => {
  it("la misma clave y el mismo checksum devuelven el resultado existente", async () => {
    const base = request(unique());
    const first = await useCase().execute(base);
    if (first.kind !== "INITIALIZED") throw new Error("expected INITIALIZED");

    const second = await useCase().execute(base);
    expect(second.kind).toBe("IDEMPOTENT");
    if (second.kind !== "IDEMPOTENT") throw new Error("unreachable");
    expect(second.identifiers.tenantId).toBe(first.identifiers.tenantId);
    expect(second.identifiers.ownerUserId).toBe(first.identifiers.ownerUserId);
    expect(second.identifiers.userRoleAssignmentId).toBe(first.identifiers.userRoleAssignmentId);

    const tenantId = first.identifiers.tenantId;
    expect(await count("SELECT COUNT(*) AS n FROM tenancy.tenants WHERE id=$1", [tenantId])).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM organization.companies WHERE tenant_id=$1", [tenantId])).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM organization.branches WHERE tenant_id=$1", [tenantId])).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM tenancy.tenant_memberships WHERE tenant_id=$1", [tenantId])).toBe(1);
    expect(await count(
      `SELECT COUNT(*) AS n FROM "authorization".user_role_assignments WHERE tenant_id=$1`, [tenantId],
    )).toBe(1);
    expect(await count(
      "SELECT COUNT(*) AS n FROM tenancy.onboarding_operations WHERE idempotency_key=$1",
      [base.idempotencyKey],
    )).toBe(1);
    expect(await count(
      "SELECT COUNT(*) AS n FROM identity.users WHERE email_normalized=$1",
      [base.owner.email.toLowerCase()],
    )).toBe(1);
  });

  it("la misma clave con otro checksum es conflicto y no altera el onboarding original", async () => {
    const id = unique();
    const base = request(id);
    const first = await useCase().execute(base);
    if (first.kind !== "INITIALIZED") throw new Error("expected INITIALIZED");
    const before = (await pool.query(
      "SELECT * FROM tenancy.onboarding_operations WHERE id=$1", [first.identifiers.onboardingId],
    )).rows[0];

    const conflicting = await useCase().execute(
      request(id, { tenant: { name: "Otro Comercio" } }),
    );
    expect(conflicting.kind).toBe("IDEMPOTENCY_CONFLICT");

    const after = (await pool.query(
      "SELECT * FROM tenancy.onboarding_operations WHERE id=$1", [first.identifiers.onboardingId],
    )).rows[0];
    expect(after).toEqual(before);
    expect(await count(
      "SELECT COUNT(*) AS n FROM tenancy.onboarding_operations WHERE idempotency_key=$1",
      [base.idempotencyKey],
    )).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM tenancy.tenants WHERE name=$1", ["Otro Comercio"])).toBe(0);
  });

  it("el checksum cubre la intención comercial, no la forma de escribirla", async () => {
    const id = unique();
    expect(initializeTenantChecksum(request(id))).toBe(initializeTenantChecksum(request(id)));
    // Un NIT con puntos y guiones es el mismo NIT.
    const plain = request(id).company.taxId!.replace(/[^0-9]/g, "");
    expect(initializeTenantChecksum(request(id)))
      .toBe(initializeTenantChecksum(request(id, {
        company: { ...request(id).company, taxId: plain },
      })));
    expect(initializeTenantChecksum(request(id)))
      .not.toBe(initializeTenantChecksum(request(id, {
        branch: { name: "Otra", timezone: "America/Bogota" },
      })));
  });

  it("dos solicitudes concurrentes equivalentes producen un solo tenant", async () => {
    // La protección no es `if (!existe) inserta()`: es la restricción única
    // del esquema, evaluada por PostgreSQL con las dos transacciones abiertas.
    const base = request(unique());
    const [a, b] = await Promise.all([
      useCase().execute(base),
      useCase().execute(base),
    ]);

    const kinds = [a.kind, b.kind].sort();
    expect(kinds).toEqual(["IDEMPOTENT", "INITIALIZED"]);
    expect(await count(
      "SELECT COUNT(*) AS n FROM tenancy.onboarding_operations WHERE idempotency_key=$1",
      [base.idempotencyKey],
    )).toBe(1);
    expect(await count(
      "SELECT COUNT(*) AS n FROM tenancy.tenants WHERE name=$1", [base.tenant.name],
    )).toBe(1);
    expect(await count(
      "SELECT COUNT(*) AS n FROM identity.users WHERE email_normalized=$1",
      [base.owner.email.toLowerCase()],
    )).toBe(1);
  });
});

// ── C · Atomicidad y recuperación ────────────────────────────────────────────

describe("ONB-002 — atomicidad y recuperación", () => {
  it("un fallo previo al commit no deja tenant, empresa, sucursal, outbox ni auditoría", async () => {
    // El fallo se provoca donde el contrato lo teme: con todo escrito y antes
    // del commit.
    const failing: TransactionalSql = {
      async withTransaction(run) {
        return transactional(pool).withTransaction(async (tx) => {
          const result = await run(tx);
          await tx.query("SELECT 1 / 0");
          return result;
        });
      },
    };

    const base = request(unique());
    await expect(new InitializeTenantUseCase(failing, () => NOW).execute(base))
      .rejects.toThrow();

    expect(await count(
      "SELECT COUNT(*) AS n FROM tenancy.onboarding_operations WHERE idempotency_key=$1",
      [base.idempotencyKey],
    )).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM tenancy.tenants WHERE name=$1", [base.tenant.name])).toBe(0);
    expect(await count(
      "SELECT COUNT(*) AS n FROM organization.companies WHERE trade_name=$1", [base.company.tradeName],
    )).toBe(0);
    expect(await count(
      "SELECT COUNT(*) AS n FROM identity.users WHERE email_normalized=$1",
      [base.owner.email.toLowerCase()],
    )).toBe(0);
    expect(await count(
      "SELECT COUNT(*) AS n FROM audit.audit_events WHERE correlation_id=$1", [base.correlationId],
    )).toBe(0);
    expect(await count(
      "SELECT COUNT(*) AS n FROM sync.outbox_entries WHERE correlation_id=$1", [base.correlationId],
    )).toBe(0);
    expect(await count(
      "SELECT COUNT(*) AS n FROM sync.sync_operations WHERE correlation_id=$1", [base.correlationId],
    )).toBe(0);
  });

  it("tras el commit, un proceso nuevo recupera el resultado por idempotency_key", async () => {
    const base = request(unique());
    const first = await useCase().execute(base);
    if (first.kind !== "INITIALIZED") throw new Error("expected INITIALIZED");

    // «Otro proceso»: pool nuevo, conexiones nuevas, ningún estado en memoria.
    const reopened = new Pool({ connectionString: DATABASE_URL });
    try {
      const recovered = await new InitializeTenantUseCase(transactional(reopened), () => NOW)
        .execute(base);
      expect(recovered.kind).toBe("IDEMPOTENT");
      if (recovered.kind !== "IDEMPOTENT") throw new Error("unreachable");
      expect(recovered.identifiers.tenantId).toBe(first.identifiers.tenantId);
      expect(recovered.status).toBe("READY_FOR_LICENSE");
    } finally {
      await reopened.end();
    }
    expect(await count(
      "SELECT COUNT(*) AS n FROM tenancy.tenants WHERE name=$1", [base.tenant.name],
    )).toBe(1);
  });
});

// ── D · Aislamiento y rechazos estables ──────────────────────────────────────

describe("ONB-002 — aislamiento multi-tenant y rechazos", () => {
  it("el propietario de un tenant no obtiene pertenencia ni rol en otro", async () => {
    const first = request(unique());
    const a = await useCase().execute(first);
    // Segundo onboarding del **mismo** propietario: otra clave, otro NIT.
    const second = request(unique(), { owner: first.owner });
    const b = await useCase().execute(second);
    if (a.kind !== "INITIALIZED" || b.kind !== "INITIALIZED") throw new Error("expected two onboardings");

    // Mismo correo ⇒ misma identidad global, dos tenants distintos.
    expect(b.identifiers.ownerUserId).toBe(a.identifiers.ownerUserId);
    expect(b.identifiers.tenantId).not.toBe(a.identifiers.tenantId);

    // Cada pertenencia nombra su tenant: nada implícito.
    const memberships = (await pool.query(
      "SELECT tenant_id FROM tenancy.tenant_memberships WHERE user_id=$1",
      [a.identifiers.ownerUserId],
    )).rows.map((row: { tenant_id: string }) => row.tenant_id).sort();
    expect(memberships).toEqual([a.identifiers.tenantId, b.identifiers.tenantId].sort());

    // Una asignación por tenant, ninguna cruzada.
    expect(await count(
      `SELECT COUNT(*) AS n FROM "authorization".user_role_assignments WHERE tenant_id=$1`,
      [a.identifiers.tenantId],
    )).toBe(1);
    expect(await count(
      `SELECT COUNT(*) AS n FROM "authorization".user_role_assignments
        WHERE tenant_id=$1 AND tenant_membership_id=$2`,
      [a.identifiers.tenantId, b.identifiers.tenantMembershipId],
    )).toBe(0);
  });

  it("una identidad comercial ya usada por otro tenant no se reutiliza en silencio", async () => {
    const id = unique();
    const original = request(id);
    const created = await useCase().execute(original);
    if (created.kind !== "INITIALIZED") throw new Error("expected INITIALIZED");

    const clone = request(unique(), {
      // Mismo NIT, escrito sin separadores.
      company: { ...original.company, taxId: original.company.taxId!.replace(/[^0-9]/g, "") },
    });
    const duplicate = await useCase().execute(clone);
    expect(duplicate.kind).toBe("COMMERCIAL_IDENTITY_TAKEN");

    expect(await count("SELECT COUNT(*) AS n FROM tenancy.tenants WHERE name=$1", [clone.tenant.name])).toBe(0);
    expect(await count(
      "SELECT COUNT(*) AS n FROM organization.companies WHERE tax_id_normalized=$1",
      [original.company.taxId!.replace(/[^0-9]/g, "")],
    )).toBe(1);
  });

  it("sin rol de negocio aprobado no hay onboarding", async () => {
    const base = request(unique(), { ownerRoleCode: "ROL_INEXISTENTE" });
    const outcome = await useCase().execute(base);
    expect(outcome.kind).toBe("OWNER_ROLE_NOT_FOUND");
    expect(await count("SELECT COUNT(*) AS n FROM tenancy.tenants WHERE name=$1", [base.tenant.name])).toBe(0);
    expect(await count(
      "SELECT COUNT(*) AS n FROM identity.users WHERE email_normalized=$1",
      [base.owner.email.toLowerCase()],
    )).toBe(0);
  });

  it("el esquema rechaza una transición inválida: READY_FOR_LICENSE no vuelve a PENDING con tenant", async () => {
    const outcome = await useCase().execute(request(unique()));
    if (outcome.kind !== "INITIALIZED") throw new Error("expected INITIALIZED");
    // `onboarding_operations_pending_ck`: PENDING exige tenant nulo. Que el
    // rechazo sea del esquema y no del código es justamente el punto.
    await expect(pool.query(
      "UPDATE tenancy.onboarding_operations SET status='PENDING' WHERE id=$1",
      [outcome.identifiers.onboardingId],
    )).rejects.toThrow(/onboarding_operations_pending_ck/);
  });

  it("los identificadores son UUID v7, que es lo que el esquema central exige", async () => {
    const value = uuidV7(new Date("2026-09-20T12:00:00.000Z"));
    expect(value[14]).toBe("7");
    expect(["8", "9", "a", "b"]).toContain(value[19]);
    const [ok] = (await pool.query("SELECT platform.is_uuid_v7($1::uuid) AS ok", [value])).rows;
    expect(ok.ok).toBe(true);
    // Un v4 sería rechazado por el CHECK, que es la razón de existir del helper.
    const [notOk] = (await pool.query("SELECT platform.is_uuid_v7($1::uuid) AS ok", [randomUUID()])).rows;
    expect(notOk.ok).toBe(false);
  });

  it("la auditoría sella el valor escrito y no transporta secretos", async () => {
    const base = request(unique());
    const outcome = await useCase().execute(base);
    if (outcome.kind !== "INITIALIZED") throw new Error("expected INITIALIZED");
    const rows = (await pool.query(
      `SELECT new_value, new_value::text AS stored_text, payload_checksum, operation_id
         FROM audit.audit_events WHERE correlation_id=$1`,
      [base.correlationId],
    )).rows as Array<{
      new_value: Record<string, unknown>; stored_text: string;
      payload_checksum: string; operation_id: string | null;
    }>;

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // El sello se recalcula desde la fila: es verificable, no decorativo.
      expect(createHash("sha256").update(row.stored_text, "utf8").digest("hex"))
        .toBe(row.payload_checksum);
      // `audit_events.operation_id` referencia `sync.sync_operations`: un
      // onboarding no es una operación de sincronización.
      expect(row.operation_id).toBeNull();
      const serialized = JSON.stringify(row.new_value).toLowerCase();
      for (const forbidden of ["password", "secret", "token", "credential", "private_key"]) {
        expect(serialized).not.toContain(forbidden);
      }
    }
  });
});

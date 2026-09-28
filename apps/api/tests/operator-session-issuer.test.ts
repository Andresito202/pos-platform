import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalSessionTrustJson } from "@pos-platform/contracts";
import {
  OperatorSessionIssuer,
  authorizationSnapshotExpiresAt,
  projectAssignments,
  type AuthorizationProjectionRow,
} from "../src/authentication/operator-session-issuer.js";

/**
 * La regla de proyección roles → SAS (`DEC-026` §13.10), sin base de datos. La
 * prueba con PostgreSQL real (`operator-session.postgres.test.ts`) mide la
 * consulta; ésta mide la unión, que es donde un error concedería de más.
 */

const TENANT = "018f0000-0000-7000-8000-00000000c001";
const COMPANY = "018f0000-0000-7000-8000-00000000c002";
const BRANCH = "018f0000-0000-7000-8000-00000000c003";
const at = (iso: string): Date => new Date(iso);
const row = (partial: Partial<AuthorizationProjectionRow>): AuthorizationProjectionRow => ({
  companyId: null, branchId: null, validFrom: at("2026-09-01T00:00:00Z"), validUntil: null,
  permissionCode: null, permissionStatus: null, ...partial,
});

describe("projectAssignments", () => {
  it("dos roles en el mismo ámbito se unen en una sola asignación y los permisos se suman", () => {
    const assignments = projectAssignments(TENANT, [
      row({ permissionCode: "SALES_SALE_CREATE", permissionStatus: "ACTIVE" }),
      row({ permissionCode: "CASH_SHIFT_OPEN", permissionStatus: "ACTIVE" }),
    ]);
    expect(assignments).toHaveLength(1);
    expect(assignments[0]!.permissions.map((permission) => permission.code)).toEqual(["CASH_SHIFT_OPEN", "SALES_SALE_CREATE"]);
  });

  it("si un rol concede y otro trae el permiso retirado, queda concedido, en cualquier orden", () => {
    for (const statuses of [["RETIRED", "ACTIVE"], ["ACTIVE", "RETIRED"]] as const) {
      const [assignment] = projectAssignments(TENANT, statuses.map((status) =>
        row({ permissionCode: "SALES_SALE_CREATE", permissionStatus: status })));
      expect(assignment!.permissions, statuses.join("→")).toEqual([{ code: "SALES_SALE_CREATE", status: "ACTIVE" }]);
    }
  });

  it("la vigencia de la unión es la intersección: nunca se concede fuera de la de un rol", () => {
    const [assignment] = projectAssignments(TENANT, [
      row({ validFrom: at("2026-09-01T00:00:00Z"), validUntil: at("2026-12-31T00:00:00Z"), permissionCode: "A", permissionStatus: "ACTIVE" }),
      row({ validFrom: at("2026-09-10T00:00:00Z"), validUntil: at("2026-10-31T00:00:00Z"), permissionCode: "B", permissionStatus: "ACTIVE" }),
      row({ validFrom: at("2026-09-05T00:00:00Z"), validUntil: null, permissionCode: "C", permissionStatus: "ACTIVE" }),
    ]);
    expect(assignment!.valid_from).toBe("2026-09-10T00:00:00.000Z");
    expect(assignment!.valid_until).toBe("2026-10-31T00:00:00.000Z");
  });

  it("un rol sin concesiones vigentes da una asignación sin permisos, no una concesión inventada", () => {
    const assignments = projectAssignments(TENANT, [row({})]);
    expect(assignments).toEqual([expect.objectContaining({ tenant_id: TENANT, permissions: [] })]);
  });

  it("ámbitos distintos no se mezclan y salen del más amplio al más concreto", () => {
    const assignments = projectAssignments(TENANT, [
      row({ companyId: COMPANY, branchId: BRANCH, permissionCode: "C", permissionStatus: "ACTIVE" }),
      row({ companyId: COMPANY, permissionCode: "B", permissionStatus: "ACTIVE" }),
      row({ permissionCode: "A", permissionStatus: "ACTIVE" }),
    ]);
    expect(assignments.map((assignment) => [assignment.company_id, assignment.branch_id, assignment.permissions[0]!.code])).toEqual([
      [null, null, "A"], [COMPANY, null, "B"], [COMPANY, BRANCH, "C"],
    ]);
  });
});

describe("OperatorSessionIssuer", () => {
  const ssaKey = generateKeyPairSync("ed25519");
  const sasKey = generateKeyPairSync("ed25519");

  it("rechaza firmar identidad y permisos con el mismo key_id", () => {
    expect(() => new OperatorSessionIssuer(
      { keyId: "SAME", privateKey: ssaKey.privateKey },
      { keyId: "SAME", privateKey: sasKey.privateKey },
    )).toThrow(/distinct/);
  });

  it("un administrador (12 h) no recibe permisos que le sobrevivan: el SAS vence con la sesión", () => {
    const issuedAt = at("2026-09-28T12:00:00Z");
    expect(authorizationSnapshotExpiresAt(issuedAt, at("2026-09-29T00:00:00Z")).toISOString()).toBe("2026-09-29T00:00:00.000Z");
    expect(authorizationSnapshotExpiresAt(issuedAt, at("2026-09-30T12:00:00Z")).toISOString()).toBe("2026-09-29T12:00:00.000Z");
  });

  it("firma cada sobre con su clave sobre la canonicalización del contrato", () => {
    const issuer = new OperatorSessionIssuer(
      { keyId: "SSA-1", privateKey: ssaKey.privateKey },
      { keyId: "SAS-1", privateKey: sasKey.privateKey },
    );
    const artifact = issuer.issue({
      tenantId: TENANT, userId: "018f0000-0000-7000-8000-00000000c010", membershipId: "018f0000-0000-7000-8000-00000000c011",
      sessionId: "018f0000-0000-7000-8000-00000000c012", installationId: "018f0000-0000-7000-8000-00000000c013",
      deviceId: "018f0000-0000-7000-8000-00000000c014", issuedAt: at("2026-09-28T12:00:00Z"),
      sessionExpiresAt: at("2026-09-29T12:00:00Z"), sequence: 7,
      projection: [row({ permissionCode: "SALES_SALE_CREATE", permissionStatus: "ACTIVE" })],
    });
    const ok = (claims: unknown, signature: string, key: typeof ssaKey.publicKey) =>
      verify(null, Buffer.from(canonicalSessionTrustJson(claims)), key, Buffer.from(signature, "base64url"));
    expect(ok(artifact.session_assertion.claims, artifact.session_assertion.signature, ssaKey.publicKey)).toBe(true);
    expect(ok(artifact.authorization_snapshot.claims, artifact.authorization_snapshot.signature, sasKey.publicKey)).toBe(true);
    expect(artifact.session_assertion.claims.sequence).toBe(7);
    expect(artifact.authorization_snapshot.claims.sequence).toBe(7);
  });
});

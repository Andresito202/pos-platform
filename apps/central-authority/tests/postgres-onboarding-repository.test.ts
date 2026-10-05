import { describe, expect, it } from "vitest";
import { PostgresOnboardingRepository } from "../src/postgres-onboarding-repository.js";

function poolFixture() {
  const calls: string[] = [];
  const client = {
    query: async (text: string) => {
      calls.push(text);
      return { rows: [], rowCount: 0 };
    },
    release: () => undefined,
  };
  return {
    calls,
    pool: { connect: async () => client } as never,
  };
}

const actor = { type: "PLATFORM_ACCOUNT" as const, id: "01890f5a-0000-7000-8000-000000000001" };

describe("PostgresOnboardingRepository", () => {
  it("keeps the complete application transaction atomic and sets actor/tenant context locally", async () => {
    const fixture = poolFixture();
    const repository = new PostgresOnboardingRepository(fixture.pool);
    await repository.transaction(async (tx) => {
      await tx.setActorContext(actor);
      await tx.setTenantContext("01890f5a-0000-7000-8000-000000000002");
      await tx.createOnboarding({
        id: "01890f5a-0000-7000-8000-000000000003",
        actor,
        idempotencyKey: "onb-001",
        requestChecksum: "a".repeat(64),
        correlationId: "01890f5a-0000-7000-8000-000000000004",
        commercialReference: "COMM-001",
      });
    });
    expect(fixture.calls[0]).toBe("BEGIN");
    expect(fixture.calls).toContain("COMMIT");
    expect(fixture.calls.some((value) => value.includes("set_config('app.actor_id'"))).toBe(true);
    expect(fixture.calls.some((value) => value.includes("set_config('app.tenant_id'"))).toBe(true);
    expect(fixture.calls.some((value) => value.includes("commercial_reference"))).toBe(true);
  });

  it("rolls back every onboarding write when the transaction fails", async () => {
    const fixture = poolFixture();
    const repository = new PostgresOnboardingRepository(fixture.pool);
    await expect(repository.transaction(async () => {
      throw new Error("ONBOARDING_TEST_FAILURE");
    })).rejects.toThrow("ONBOARDING_TEST_FAILURE");
    expect(fixture.calls).toEqual(["BEGIN", "ROLLBACK"]);
  });
});

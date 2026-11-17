import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { SyncOperation } from "@pos-platform/contracts";
import { upsertDomainProjection } from "../src/central-domain-consumers.js";

function operation(overrides: Partial<SyncOperation> = {}): SyncOperation {
  const id = randomUUID();
  return {
    operation_id: id,
    tenant_id: randomUUID(),
    company_id: randomUUID(),
    branch_id: randomUUID(),
    device_id: randomUUID(),
    installation_id: randomUUID(),
    session_id: randomUUID(),
    actor_id: randomUUID(),
    aggregate_type: "SALE",
    aggregate_id: randomUUID(),
    operation_type: "SALE_CREATED",
    authority_policy: "LOCAL_AUTHORITATIVE_UNTIL_SYNC",
    local_sequence: 1,
    idempotency_key: `idemp-${id}`,
    expected_version: null,
    payload_schema_version: "1.0.0",
    payload: { sale_id: randomUUID() },
    payload_checksum: "a".repeat(64),
    causation_id: null,
    correlation_id: randomUUID(),
    occurred_at_local: new Date().toISOString(),
    recorded_at_local: new Date().toISOString(),
    ...overrides,
  } as SyncOperation;
}

describe("upsertDomainProjection", () => {
  it("writes typed APPLIED projection SQL and skips untyped", async () => {
    const calls: unknown[][] = [];
    const client = {
      query: vi.fn(async (...args: unknown[]) => {
        calls.push(args);
        return { rowCount: 1, rows: [] };
      }),
    } as unknown as PoolClient;

    await upsertDomainProjection(client, operation(), {
      server_status: "SERVER_ACCEPTED",
      server_result_code: "DOMAIN_APPLIED_SALES",
      review_required: false,
      applied: true,
    });
    expect(calls).toHaveLength(1);
    expect(String(calls[0]![0])).toContain("INSERT INTO sync.domain_projections");
    expect(String(calls[0]![0])).toContain("ON CONFLICT (tenant_id, operation_id) DO NOTHING");
    expect((calls[0]![1] as unknown[])[9]).toBe("APPLIED");

    await upsertDomainProjection(client, operation({ operation_type: "SYNC.TEST" }), {
      server_status: "SERVER_ACCEPTED",
      server_result_code: "DURABLE_RECEIVED_UNTYPED",
      review_required: false,
      applied: false,
    });
    expect(calls).toHaveLength(1);
  });

  it("records CONFLICT projection status for inventory overlap outcomes", async () => {
    const client = {
      query: vi.fn(async () => ({ rowCount: 1, rows: [] })),
    } as unknown as PoolClient;
    await upsertDomainProjection(
      client,
      operation({ operation_type: "INVENTORY_RESERVATION_CREATE", payload: { reservation_id: randomUUID(), presentation_id: randomUUID() } }),
      {
        server_status: "CONFLICT",
        server_result_code: "INVENTORY_DISTRIBUTED_OVERLAP",
        review_required: true,
        applied: false,
      },
    );
    const params = (client.query as ReturnType<typeof vi.fn>).mock.calls[0]![1] as unknown[];
    expect(params[9]).toBe("CONFLICT");
    expect(params[6]).toBe("INVENTORY");
  });
});

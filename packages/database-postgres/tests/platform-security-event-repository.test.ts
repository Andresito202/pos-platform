import { describe, expect, it, vi } from "vitest";
import type { Pool, PoolClient } from "pg";
import {
  PlatformSecurityEventCode,
  PostgresPlatformSecurityEventRepository,
  type PlatformSecurityEventWrite,
} from "../src/index.js";

const INPUT: PlatformSecurityEventWrite = {
  user_id: "018f0000-0000-7000-8000-0000000000a1",
  session_id: null,
  tenant_id: null,
  event_code: PlatformSecurityEventCode.LOGIN_FAILED,
  result: "REJECTED",
  reason_code: "INVALID_CREDENTIAL",
  correlation_id: "018f0000-0000-7000-8000-0000000000c2",
  occurred_at: "2026-10-08T12:00:00.000Z",
};

describe("PostgresPlatformSecurityEventRepository", () => {
  it("writes only to identity.security_events and takes server_recorded_at from PostgreSQL", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{
        user_id: INPUT.user_id,
        session_id: null,
        tenant_id: null,
        event_code: INPUT.event_code,
        result: INPUT.result,
        reason_code: INPUT.reason_code,
        correlation_id: INPUT.correlation_id,
        occurred_at: new Date(INPUT.occurred_at),
        server_recorded_at: new Date("2026-10-08T12:00:01.000Z"),
      }],
      rowCount: 1,
    });
    const repository = new PostgresPlatformSecurityEventRepository({ query } as unknown as Pool);

    const event = await repository.append(INPUT);

    expect(query).toHaveBeenCalledOnce();
    const [sql, values] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("INSERT INTO identity.security_events");
    expect(sql).toContain("clock_timestamp()");
    expect(sql).not.toContain("UPDATE identity.security_events");
    expect(values).toHaveLength(9);
    expect(values).not.toContain("must-not-be-logged");
    expect(event.server_recorded_at).toBe("2026-10-08T12:00:01.000Z");
  });

  it("uses the supplied transaction client when provided", async () => {
    const transactionQuery = vi.fn().mockResolvedValue({
      rows: [{
        user_id: INPUT.user_id,
        session_id: null,
        tenant_id: null,
        event_code: INPUT.event_code,
        result: INPUT.result,
        reason_code: INPUT.reason_code,
        correlation_id: INPUT.correlation_id,
        occurred_at: new Date(INPUT.occurred_at),
        server_recorded_at: new Date("2026-10-08T12:00:01.000Z"),
      }],
      rowCount: 1,
    });
    const poolQuery = vi.fn();
    const repository = new PostgresPlatformSecurityEventRepository({ query: poolQuery } as unknown as Pool);

    await repository.append(INPUT, { query: transactionQuery } as unknown as PoolClient);

    expect(transactionQuery).toHaveBeenCalledOnce();
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it("rejects extra credential or token fields before reaching PostgreSQL", async () => {
    const query = vi.fn();
    const repository = new PostgresPlatformSecurityEventRepository({ query } as unknown as Pool);

    await expect(repository.append({
      ...INPUT,
      refresh_token: "must-not-be-logged",
    } as PlatformSecurityEventWrite)).rejects.toThrow();

    expect(query).not.toHaveBeenCalled();
  });
});

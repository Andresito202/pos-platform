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
    expect(sql).toContain("id, user_id, session_id, tenant_id, device_id, event_code, result");
    expect(sql).toContain("reason_code, correlation_id, occurred_at, server_recorded_at");
    expect(sql).not.toMatch(/\b(password|refresh_token|mfa_secret)\b/i);
    expect(values).toHaveLength(9);
    expect(values[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(values[0]).not.toBe(INPUT.correlation_id);
    expect(values.slice(1)).toEqual([
      INPUT.user_id,
      INPUT.session_id,
      INPUT.tenant_id,
      INPUT.event_code,
      INPUT.result,
      INPUT.reason_code,
      INPUT.correlation_id,
      INPUT.occurred_at,
    ]);
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

  it("propagates transaction write failures without falling back to the pool", async () => {
    const transactionError = new Error("transaction aborted");
    const transactionQuery = vi.fn().mockRejectedValue(transactionError);
    const poolQuery = vi.fn();
    const repository = new PostgresPlatformSecurityEventRepository({ query: poolQuery } as unknown as Pool);

    await expect(repository.append(INPUT, { query: transactionQuery } as unknown as PoolClient))
      .rejects.toBe(transactionError);

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
  it("rejects tenant-scoped events without a session before reaching PostgreSQL", async () => {
    const query = vi.fn();
    const repository = new PostgresPlatformSecurityEventRepository({ query } as unknown as Pool);

    await expect(repository.append({
      ...INPUT,
      tenant_id: "018f0000-0000-7000-8000-0000000000d3",
      session_id: null,
    })).rejects.toThrow();

    expect(query).not.toHaveBeenCalled();
  });

  it("rejects caller-supplied server timestamps before reaching PostgreSQL", async () => {
    const query = vi.fn();
    const repository = new PostgresPlatformSecurityEventRepository({ query } as unknown as Pool);

    await expect(repository.append({
      ...INPUT,
      server_recorded_at: INPUT.occurred_at,
    } as PlatformSecurityEventWrite)).rejects.toThrow();

    expect(query).not.toHaveBeenCalled();
  });
  it("rejects a persisted row whose server timestamp precedes occurred_at", async () => {
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
        server_recorded_at: new Date("2026-10-08T11:59:59.000Z"),
      }],
      rowCount: 1,
    });
    const repository = new PostgresPlatformSecurityEventRepository({ query } as unknown as Pool);

    await expect(repository.append(INPUT)).rejects.toThrow();
  });

  it("fails closed when PostgreSQL reports no inserted row", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    const repository = new PostgresPlatformSecurityEventRepository({ query } as unknown as Pool);

    await expect(repository.append(INPUT)).rejects.toThrow("PLATFORM_SECURITY_EVENT_INSERT_RETURNED_NO_ROW");
  });

});

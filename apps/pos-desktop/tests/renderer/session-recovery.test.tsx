// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useAuthorizationCapabilities } from "../../renderer/src/hooks/useAuthorizationCapabilities.js";

const unbound = { status: "REJECTED", result_code: "SESSION_NOT_BOUND", result: { outcome: "UNAUTHORIZED", permissions: [] } };
const available = { status: "SUCCEEDED", result_code: "AVAILABLE", result: { outcome: "AVAILABLE", permissions: ["CATALOG_PRODUCT_READ"] } };
const active = { status: "SUCCEEDED", result_code: "ACTIVE", result: { outcome: "ACTIVE",
  session_id: "11111111-1111-4111-8111-111111111111", offline_valid_until: "2026-10-22T23:00:00.000Z", decision: null } };
function service(recovery: unknown) {
  const capabilities = vi.fn().mockResolvedValueOnce(unbound).mockResolvedValue(available);
  const recover = vi.fn().mockResolvedValue(recovery);
  Object.defineProperty(window, "posService", { configurable: true, value: {
    "authorization.capabilities.get": capabilities, "session.recover": recover,
  } });
  return { capabilities, recover };
}

describe("canonical session recovery coordination (unit fixtures only)", () => {
  it("ACTIVE rereads capabilities; the recovery UUID grants nothing", async () => {
    const api = service(active);
    const { result } = renderHook(useAuthorizationCapabilities);
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    expect([...result.current.permissions]).toEqual(["CATALOG_PRODUCT_READ"]);
    expect(api.capabilities).toHaveBeenCalledTimes(2);
    expect(api.recover.mock.calls[0]?.[0]).toMatchObject({ message_type: "session.recover", payload: {} });
  });
  it("ACTIVE cannot bypass a rejected authorization snapshot", async () => {
    const api = service(active);
    api.capabilities.mockReset().mockResolvedValueOnce(unbound).mockResolvedValue({
      status: "REJECTED", result_code: "AUTHORIZATION_SNAPSHOT_UNAVAILABLE", result: { outcome: "UNAUTHORIZED", permissions: [] },
    });
    const { result } = renderHook(useAuthorizationCapabilities);
    await waitFor(() => expect(result.current.phase).toBe("error"));
    expect(result.current.permissions.size).toBe(0);
  });
  it.each([
    { status: "SUCCEEDED", result_code: "ACTIVE", result: { outcome: "ACTIVE", session_id: null, offline_valid_until: null, decision: null } },
    { status: "SUCCEEDED", result_code: "NONE", result: { outcome: "NONE", session_id: active.result.session_id, offline_valid_until: null, decision: null } },
    { status: "SUCCEEDED", result_code: "ACTIVE", result: { ...active.result, permissions: ["AUDIT_EVENT_READ"] } },
    { status: "REJECTED", result_code: "UNVERIFIABLE", result: { outcome: "UNVERIFIABLE", session_id: null, offline_valid_until: null, decision: "SESSION_EXPIRED" } },
  ])("rejects malformed or unverifiable recovery %#", async recovery => {
    const api = service(recovery);
    const { result } = renderHook(useAuthorizationCapabilities);
    await waitFor(() => expect(result.current.phase).toBe("error"));
    expect(result.current.permissions.size).toBe(0);
    expect(api.capabilities).toHaveBeenCalledTimes(1);
  });
  it("ignores a stale recovery after retry and clears old permissions immediately", async () => {
    let finish!: (value: unknown) => void;
    const api = service(active);
    api.recover.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const { result } = renderHook(useAuthorizationCapabilities);
    await waitFor(() => expect(api.recover).toHaveBeenCalledTimes(1));
    act(() => result.current.retry());
    expect(result.current.phase).toBe("loading");
    expect(result.current.permissions.size).toBe(0);
    await waitFor(() => expect(result.current.phase).toBe("ready"));
    await act(async () => finish({ status: "SUCCEEDED", result_code: "NONE", result: { outcome: "NONE", session_id: null, offline_valid_until: null, decision: null } }));
    expect(result.current.phase).toBe("ready");
    expect([...result.current.permissions]).toEqual(["CATALOG_PRODUCT_READ"]);
  });
  it("does not recover on a bound session authorization denial", async () => {
    const api = service(active);
    api.capabilities.mockReset().mockResolvedValue({ status: "REJECTED", result_code: "AUTHORIZATION_SNAPSHOT_UNAVAILABLE", result: { outcome: "UNAUTHORIZED", permissions: [] } });
    const { result } = renderHook(useAuthorizationCapabilities);
    await waitFor(() => expect(result.current.phase).toBe("error"));
    expect(api.recover).not.toHaveBeenCalled();
  });
});

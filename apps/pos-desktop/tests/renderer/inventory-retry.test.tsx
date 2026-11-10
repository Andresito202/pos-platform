// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useInventoryAdmin } from "../../renderer/src/hooks/useInventoryAdmin.js";
const mocks = vi.hoisted(() => ({ call: vi.fn(), key: vi.fn() }));
vi.mock("../../renderer/src/pos-service.js", () => ({ callCommercial: mocks.call, newIdempotencyKey: mocks.key }));
const args = ["018f0000-0000-7000-8000-000000000001", "PURCHASE_RECEIPT", "2", "PURCHASE", "2026-11-10"] as const;
const posted = { status: "SUCCEEDED", result_code: "POSTED", result: { outcome: "POSTED", stock_sequence: 1, quantity_after: "2.000000", available: null } };
beforeEach(() => { mocks.call.mockReset(); mocks.key.mockReset().mockReturnValueOnce("first").mockReturnValue("second"); });
describe("manual inventory retries while panel is mounted", () => {
  it("retains immutable payload and key after lost reply and rejects another mutation", async () => {
    mocks.call.mockRejectedValueOnce(Error("lost reply")).mockResolvedValue(posted);
    const { result } = renderHook(() => useInventoryAdmin());
    await act(async () => { await result.current.receive(...args); });
    expect(result.current.pending).toBe(true);
    await act(async () => { await result.current.adjust(args[0], "SHRINKAGE", "1", "LOSS", args[4]); });
    expect(mocks.call).toHaveBeenCalledTimes(1);
    await act(async () => { await result.current.retryPending(); });
    expect(mocks.call.mock.calls[1]).toEqual(mocks.call.mock.calls[0]);
    expect(result.current.pending).toBe(false);
    await act(async () => { await result.current.receive(...args); });
    expect(mocks.call.mock.calls[2]?.[2]).toBe("second");
  });
  it("coalesces rapid double submission and retains pending state for unknown replies", async () => {
    let finish!: (value: unknown) => void;
    mocks.call.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { result } = renderHook(() => useInventoryAdmin());
    let first!: Promise<void>;
    act(() => { first = result.current.receive(...args); void result.current.receive(...args); });
    expect(mocks.call).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ status: "UNKNOWN", result_code: "UNKNOWN", result: null }); await first; });
    expect(result.current.pending).toBe(true);
  });
});

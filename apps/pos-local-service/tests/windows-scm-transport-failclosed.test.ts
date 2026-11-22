import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalDatabase } from "@pos-platform/database-sqlite";
import type { WindowsScmHandoffProvision } from "@pos-platform/contracts";
import type { AttestedWindowsPipe, WindowsPipeAdapter } from "@pos-platform/local-channel";
import { WindowsScmChannelTransport } from "../src/channel/windows-scm-transport.js";
import { SqliteWindowsHandoffLeaseAuthority } from "../src/channel/sqlite-replay-state.js";

const provision = {
  role: "SERVICE",
  signer_private_file: "C:\\service-signer.test",
  handoff: { poll_ms: 100 },
} as unknown as WindowsScmHandoffProvision;
const dummyDatabase = {} as LocalDatabase;

function adapter(overrides: Partial<WindowsPipeAdapter> = {}): WindowsPipeAdapter {
  return {
    listen: vi.fn(() => ({})),
    accept: vi.fn(() => new Promise<AttestedWindowsPipe>(() => undefined)),
    connect: vi.fn(() => Promise.reject(Error("not a desktop"))),
    stop: vi.fn(),
    ...overrides,
  };
}

afterEach(() => { vi.useRealTimers(); });

describe("SCM transport fail-closed lifecycle", () => {
  it("reports lease check failure after checking all active connections", () => {
    const ledger = new SqliteWindowsHandoffLeaseAuthority(dummyDatabase, provision.handoff);
    const internals = ledger as unknown as {connected:Map<string, unknown>; assertConnectionActive:(id:string)=>void};
    internals.connected.set("first", {}); internals.connected.set("second", {});
    const check = vi.spyOn(internals, "assertConnectionActive").mockImplementation(id => {
      if (id === "first") throw Error("DURABLE_LEDGER_FAILED");
    });
    expect(() => ledger.checkConnections()).toThrow("DURABLE_LEDGER_FAILED");
    expect(check.mock.calls.map(([id]) => id)).toEqual(["first", "second"]);
  });
  it("a native listen exception stops the transport and forbids subsequent starts", async () => {
    const mock = adapter({ listen: vi.fn(() => { throw Error("NATIVE_LISTEN_FAILED"); }) });
    const transport = new WindowsScmChannelTransport(
      provision, dummyDatabase, Buffer.alloc(32, 1),
      { adapter: mock, seal: () => { throw Error("must not publish"); } },
    );
    await expect(transport.start(() => undefined)).rejects.toThrow("NATIVE_LISTEN_FAILED");
    await expect(transport.stop()).resolves.toBeUndefined();
    await expect(transport.start(() => undefined)).rejects.toThrow("SCM_TRANSPORT_STOPPED");
    expect(mock.accept).not.toHaveBeenCalled();
  });

  it("a lease polling failure stops native listening and never continues serving", async () => {
    vi.useFakeTimers();
    const stop = vi.fn();
    const mock = adapter({ stop, accept: vi.fn(async () => { throw Error("NO_CONNECTION"); }) });
    const transport = new WindowsScmChannelTransport(
      provision, dummyDatabase, Buffer.alloc(32, 1),
      { adapter: mock, seal: () => { throw Error("must not publish"); } },
    );
    // This injected failure simulates SQLite ledger failure during polling.
    const internal = transport as unknown as { ledger: { checkConnections: () => void } };
    internal.ledger.checkConnections = () => { throw Error("DURABLE_LEDGER_FAILED"); };
    await transport.start(() => undefined);
    await vi.advanceTimersByTimeAsync(110);
    const closing = transport.stop();
    await vi.runOnlyPendingTimersAsync();
    await closing;
    expect(stop).toHaveBeenCalledTimes(1);
    await expect(transport.start(() => undefined)).rejects.toThrow("SCM_TRANSPORT_STOPPED");
  });
});

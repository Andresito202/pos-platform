import { describe, it, expect } from "vitest";
import { IPC_ALLOWED_CHANNELS, isAllowedChannel } from "../src/ipc-allowlist.js";

describe("ipc-allowlist", () => {
  it("contains exactly the three operational channels", () => {
    expect(IPC_ALLOWED_CHANNELS).toContain("pos:runtime.status.get");
    expect(IPC_ALLOWED_CHANNELS).toContain("pos:operation.result.get");
    expect(IPC_ALLOWED_CHANNELS).toContain("pos:operation.confirm");
    expect(IPC_ALLOWED_CHANNELS).toHaveLength(3);
  });

  it("accepts each channel in the allowlist", () => {
    for (const ch of IPC_ALLOWED_CHANNELS) {
      expect(isAllowedChannel(ch)).toBe(true);
    }
  });

  it("rejects the handshake channel — renderer must not initiate handshake", () => {
    expect(isAllowedChannel("pos:runtime.handshake")).toBe(false);
  });

  it("rejects arbitrary channels not in the allowlist", () => {
    expect(isAllowedChannel("pos:unknown")).toBe(false);
    expect(isAllowedChannel("fs:read")).toBe(false);
    expect(isAllowedChannel("shell:open")).toBe(false);
    expect(isAllowedChannel("ipcRenderer")).toBe(false);
    expect(isAllowedChannel("")).toBe(false);
  });

  it("rejects channels that are prefixes or supersets of allowed ones", () => {
    expect(isAllowedChannel("pos:")).toBe(false);
    expect(isAllowedChannel("pos:runtime.status.get.extra")).toBe(false);
    expect(isAllowedChannel("pos:operation")).toBe(false);
  });
});

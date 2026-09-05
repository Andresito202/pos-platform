import { describe, it, expect } from "vitest";
import { IPC_ALLOWED_CHANNELS, isAllowedChannel } from "../src/ipc-allowlist.js";

describe("ipc-allowlist", () => {
  it("contains exactly the ratified operational and commercial channels", () => {
    expect(Array.from(IPC_ALLOWED_CHANNELS)).toEqual([
      "pos:runtime.status.get",
      "pos:operation.result.get",
      "pos:operation.confirm",
      "pos:session.activate",
      "pos:session.recover",
      "pos:cash.shift.open",
      "pos:cash.shift.close",
      "pos:sale.create",
    ]);
  });

  it("exposes every commercial channel with the pos: prefix", () => {
    for (const channel of [
      "pos:session.activate",
      "pos:session.recover",
      "pos:cash.shift.open",
      "pos:cash.shift.close",
      "pos:sale.create",
    ]) {
      expect(isAllowedChannel(channel)).toBe(true);
      // El nombre sin prefijo pertenece a la frontera main ↔ servicio y no
      // debe ser invocable desde el renderer (`DEC-014` §3.2).
      expect(isAllowedChannel(channel.slice("pos:".length))).toBe(false);
    }
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

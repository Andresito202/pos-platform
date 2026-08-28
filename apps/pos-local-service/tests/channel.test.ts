import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encodeFrame, FrameDecoder, LocalChannelAuthenticator, localChannelEndpoint } from "../src/index.js";
const clock = { now: () => new Date("2026-08-28T00:00:00Z") };

describe("local channel", () => {
  it("decodes fragmented and coalesced frames", () => {
    const decoder = new FrameDecoder(); const combined = Buffer.concat([encodeFrame({a:1}), encodeFrame({b:2})]);
    expect(decoder.push(combined.subarray(0, 5))).toEqual([]);
    expect(decoder.push(combined.subarray(5))).toEqual([{a:1},{b:2}]);
  });
  it("fails closed on oversized frames", () => {
    const header = Buffer.alloc(4); header.writeUInt32BE(1_048_577);
    expect(() => new FrameDecoder().push(header)).toThrow("size rejected");
  });
  it("authenticates, detects tampering and rejects replay", () => {
    const auth = new LocalChannelAuthenticator(randomBytes(32), clock);
    const frame = auth.sign({message_type:"runtime.status.get"}, "1.0.0");
    expect(auth.verify(frame).payload).toEqual({message_type:"runtime.status.get"});
    expect(() => auth.verify(frame)).toThrow("replay");
    const other = new LocalChannelAuthenticator(randomBytes(32), clock);
    expect(() => other.verify(frame)).toThrow("MAC");
  });
  it("uses named pipes in production and explicit sockets only in tests", () => {
    const id="018f0000-0000-7000-8000-000000000001";
    expect(localChannelEndpoint(id,"win32")).toContain("\\\\.\\pipe\\camacho-pos-");
    expect(() => localChannelEndpoint(id,"linux")).toThrow("requires Windows");
    expect(localChannelEndpoint(id,"linux","/tmp")).toContain(".sock");
  });
});

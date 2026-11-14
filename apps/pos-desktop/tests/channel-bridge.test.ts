import { describe, it, expect, vi } from "vitest";
import { ChannelBridge, type ServiceChannel } from "../src/channel-bridge.js";

function makeChannel(response: unknown): ServiceChannel {
  return {
    request: vi.fn().mockResolvedValue(response),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe("channel-bridge", () => {
  it("forwards allowed channel requests to the service channel", async () => {
    const channel = makeChannel({ status: "SUCCEEDED" });
    const bridge = new ChannelBridge(channel);

    const payload = { message_type: "runtime.status.get", some: "payload" };
    const result = await bridge.handleInvoke("pos:runtime.status.get", payload);

    expect(channel.request).toHaveBeenCalledWith(payload);
    expect(result).toEqual({ status: "SUCCEEDED" });
  });

  it("forwards operation.result.get channel", async () => {
    const channel = makeChannel({ status: "SUCCEEDED", result: {} });
    const bridge = new ChannelBridge(channel);

    await bridge.handleInvoke("pos:operation.result.get", { message_type: "operation.result.get", operation_id: "op-1" });

    expect(channel.request).toHaveBeenCalledWith({ message_type: "operation.result.get", operation_id: "op-1" });
  });

  it("forwards operation.confirm channel", async () => {
    const channel = makeChannel({ status: "SUCCEEDED" });
    const bridge = new ChannelBridge(channel);

    await bridge.handleInvoke("pos:operation.confirm", { message_type: "operation.confirm", operation_id: "op-2" });

    expect(channel.request).toHaveBeenCalledWith({ message_type: "operation.confirm", operation_id: "op-2" });
  });

  it("blocks a different operation type sent through an allowed IPC method", async () => {
    const channel = makeChannel({ status: "SUCCEEDED" });
    const bridge = new ChannelBridge(channel);
    await expect(bridge.handleInvoke("pos:runtime.status.get", {
      message_type: "operation.confirm",
      operation_id: "00000000-0000-4000-8000-000000000001",
    })).rejects.toThrow("IPC message type does not match channel");
    expect(channel.request).not.toHaveBeenCalled();
  });

  it("blocks internal handshake smuggled through a public channel", async () => {
    const channel = makeChannel({});
    const bridge = new ChannelBridge(channel);
    await expect(bridge.handleInvoke("pos:runtime.status.get", {
      message_type: "runtime.handshake",
    })).rejects.toThrow("IPC message type does not match channel");
    expect(channel.request).not.toHaveBeenCalled();
  });

  it("rejects missing and malformed message type without forwarding", async () => {
    const channel = makeChannel({});
    const bridge = new ChannelBridge(channel);
    for (const value of [null, "runtime.status.get", [], {}, { message_type: 7 }]) {
      await expect(bridge.handleInvoke("pos:runtime.status.get", value)).rejects.toThrow("IPC message type does not match channel");
    }
    expect(channel.request).not.toHaveBeenCalled();
  });

  it("rejects non-allowlisted channels without calling service", async () => {
    const channel = makeChannel({});
    const bridge = new ChannelBridge(channel);

    await expect(bridge.handleInvoke("fs:read", {})).rejects.toThrow("IPC channel not allowed: fs:read");
    expect(channel.request).not.toHaveBeenCalled();
  });

  it("rejects shell channel", async () => {
    const channel = makeChannel({});
    const bridge = new ChannelBridge(channel);

    await expect(bridge.handleInvoke("shell:open", {})).rejects.toThrow("IPC channel not allowed");
    expect(channel.request).not.toHaveBeenCalled();
  });

  it("rejects handshake channel — renderer must not initiate handshake", async () => {
    const channel = makeChannel({});
    const bridge = new ChannelBridge(channel);

    await expect(bridge.handleInvoke("pos:runtime.handshake", {})).rejects.toThrow("IPC channel not allowed");
    expect(channel.request).not.toHaveBeenCalled();
  });

  it("rejects empty channel", async () => {
    const channel = makeChannel({});
    const bridge = new ChannelBridge(channel);

    await expect(bridge.handleInvoke("", {})).rejects.toThrow("IPC channel not allowed");
    expect(channel.request).not.toHaveBeenCalled();
  });

  it("propagates service channel errors", async () => {
    const channel: ServiceChannel = {
      request: vi.fn().mockRejectedValue(new Error("service unavailable")),
      close: vi.fn().mockResolvedValue(undefined),
    };
    const bridge = new ChannelBridge(channel);

    await expect(bridge.handleInvoke("pos:runtime.status.get", { message_type: "runtime.status.get" })).rejects.toThrow("service unavailable");
  });
});

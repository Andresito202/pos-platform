import { describe, it, expect, vi } from "vitest";
import { LocalServiceChannel } from "../src/local-service-channel.js";
import { ChannelBridge } from "../src/channel-bridge.js";

const ENVELOPE = {
  protocol_version: "1.0.0",
  message_type: "sale.create",
  request_id: "018f0000-0000-7000-8000-000000000001",
  correlation_id: "018f0000-0000-7000-8000-000000000002",
  payload_schema_version: "1.0.0",
  payload: {},
};

describe("LocalServiceChannel", () => {
  it("entrega la petición al cliente del canal sin reescribirla", async () => {
    const request = vi.fn().mockResolvedValue({ status: "SUCCEEDED" });
    const channel = new LocalServiceChannel({ request, close: vi.fn() });

    await channel.request(ENVELOPE);

    expect(request).toHaveBeenCalledWith(ENVELOPE);
  });

  it("devuelve la respuesta del canal tal cual", async () => {
    const response = { status: "SUCCEEDED", result_code: "CREATED", result: { outcome: "CREATED" } };
    const channel = new LocalServiceChannel({
      request: vi.fn().mockResolvedValue(response),
      close: vi.fn(),
    });

    expect(await channel.request(ENVELOPE)).toBe(response);
  });

  it("propaga el fallo del transporte en vez de fabricar un resultado", async () => {
    const channel = new LocalServiceChannel({
      request: vi.fn().mockRejectedValue(new Error("local channel client is not connected")),
      close: vi.fn(),
    });

    await expect(channel.request(ENVELOPE)).rejects.toThrow("not connected");
  });

  it("propaga un timeout del canal", async () => {
    const channel = new LocalServiceChannel({
      request: vi.fn().mockRejectedValue(new Error("local channel request timed out after 5000ms")),
      close: vi.fn(),
    });

    await expect(channel.request(ENVELOPE)).rejects.toThrow("timed out");
  });

  it("cierra delegando en el cliente", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    await new LocalServiceChannel({ request: vi.fn(), close }).close();
    expect(close).toHaveBeenCalledOnce();
  });

  it("encaja en ChannelBridge: el canal permitido llega al servicio", async () => {
    const request = vi.fn().mockResolvedValue({ status: "SUCCEEDED" });
    const bridge = new ChannelBridge(new LocalServiceChannel({ request, close: vi.fn() }));

    await bridge.handleInvoke("pos:sale.create", ENVELOPE);

    expect(request).toHaveBeenCalledWith(ENVELOPE);
  });

  it("un canal fuera de la allowlist no llega al servicio", async () => {
    const request = vi.fn();
    const bridge = new ChannelBridge(new LocalServiceChannel({ request, close: vi.fn() }));

    await expect(bridge.handleInvoke("pos:database.read", ENVELOPE)).rejects.toThrow("not allowed");
    expect(request).not.toHaveBeenCalled();
  });
});

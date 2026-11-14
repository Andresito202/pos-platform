// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { uuidV7 } from "@pos-platform/contracts";
import { PlatformActivations } from "../../renderer/src/components/PlatformActivations.js";
import { PlatformClient } from "../../renderer/src/platform-client.js";
const sample = () => ({ activationId: uuidV7(), licenseId: uuidV7(), companyId: uuidV7(), deviceId: uuidV7(), status: "ACTIVE" as const, issuedAt: null, revokedAt: null });
describe("GLOBAL license activations", () => {
  it("validates response and IDs and uses existing same-origin transport", async () => {
    const row = sample();
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ activations: [row], nextCursor: null })));
    const client = new PlatformClient({ protocol: "https:", origin: "https://central.example.test" }, transport);
    expect((await client.activations()).activations).toEqual([row]);
    expect(transport.mock.calls[0]?.[1]).toMatchObject({ method: "POST", credentials: "same-origin", body: '{"after":null}' });
    await expect(client.revokeActivation("wrong", uuidV7())).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
    transport.mockResolvedValue(new Response(JSON.stringify({ status: "ACTIVE", idempotent: false })));
    await expect(client.revokeActivation(row.activationId, uuidV7())).rejects.toThrow("no confirmó");
  });
  it("requires selection and confirmation, and displays only confirmed revocation", async () => {
    const row = sample();
    const client = { activations: vi.fn().mockResolvedValue({ activations: [row], nextCursor: null }), revokeActivation: vi.fn().mockResolvedValue({ status: "REVOKED", idempotent: false }) };
    render(<PlatformActivations client={client as unknown as PlatformClient} />);
    fireEvent.click(await screen.findByRole("button", { name: "Revocar activación" }));
    expect(screen.getByRole("button", { name: "Confirmar revocación en Central" }).hasAttribute("disabled")).toBe(true);
    expect(client.revokeActivation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar revocación en Central" }));
    await screen.findByText("Revocada en Central");
    expect(client.revokeActivation).toHaveBeenCalledWith(row.activationId, expect.any(String));
    expect(screen.getByText(/no se bloquea inmediatamente/)).toBeTruthy();
  });
  it("does not manufacture rows or successful revocation on rejection", async () => {
    const client = { activations: vi.fn().mockRejectedValue(Error("Permiso denegado")), revokeActivation: vi.fn() };
    render(<PlatformActivations client={client as unknown as PlatformClient} />);
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Revocar activación" })).toBeNull();
    expect(screen.queryByText("No hay activaciones registradas.")).toBeNull();
    await waitFor(() => expect(client.revokeActivation).not.toHaveBeenCalled());
  });
});

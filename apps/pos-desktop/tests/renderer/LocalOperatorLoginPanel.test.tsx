// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LocalOperatorLoginPanel } from "../../renderer/src/components/LocalOperatorLoginPanel.js";

function response(outcome: "NO_SESSION" | "DENIED") {
  return { protocol_version: "1.0.0", request_id: "11111111-1111-4111-8111-111111111111",
    correlation_id: "11111111-1111-4111-8111-111111111112", operation_id: null,
    status: "SUCCEEDED", result_code: outcome, result_schema_version: "1.0.0", error: null,
    server_time: "2026-11-10T00:00:00.000Z",
    result: { outcome, username: null, role: null, expires_at: null } };
}

describe("Local login form", () => {
  it("submits the entered identity without asserting a role and clears visible secrets after submission", async () => {
    const login = vi.fn<(request: unknown) => Promise<unknown>>().mockResolvedValue(response("DENIED"));
    Object.defineProperty(window, "posService", { configurable: true, value: {
      "local.operator.session": vi.fn().mockResolvedValue(response("NO_SESSION")),
      "local.operator.login": login,
    } });
    const authenticated = vi.fn();
    render(<LocalOperatorLoginPanel onAuthenticated={authenticated} />);
    const username = await screen.findByLabelText("Usuario");
    expect(username.tagName).toBe("INPUT");
    expect(username.getAttribute("maxlength")).toBe("64");
    fireEvent.change(username, { target: { value: "cajero.prueba" } });
    const password = screen.getByLabelText("Contraseña") as HTMLInputElement;
    fireEvent.change(password, { target: { value: "test-only-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Mostrar contraseña" }));
    expect(password.type).toBe("text");
    expect(login).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Ingresar" }));
    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    expect(login.mock.calls[0]![0]).toMatchObject({ payload: { username: "cajero.prueba", password: "test-only-password" } });
    expect((login.mock.calls[0]![0] as {payload: object}).payload).not.toHaveProperty("role");
    expect(password.value).toBe("");
    expect(password.type).toBe("password");
    expect(authenticated).not.toHaveBeenCalled();
    await screen.findByText("Usuario o contraseña incorrectos.");
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App, loginRequired } from "../../renderer/src/App.js";
import { loginFailureMessage } from "../../renderer/src/hooks/useOperatorAuth.js";
import { RENDERER_API_METHODS } from "../../src/preload-api.js";
import { SessionLoginOutcomeSchema } from "@pos-platform/contracts";

/**
 * Puerta de login de la ventana (`DEC-026` §13.11). El doble del servicio
 * responde como el real: `session.recover` sin sesión, `session.login`
 * autentica o rechaza, `session.end` cierra. La ventana no decide nada por su
 * cuenta: pinta lo que el servicio respondió.
 */

const SESSION = "018f0000-0000-7000-8000-0000000c0001";
const UNTIL = new Date(Date.now() + 3_600_000).toISOString();

function envelope(status: "SUCCEEDED" | "REJECTED", result_code: string, result: unknown) {
  return { status, result_code, result };
}

function makeService(overrides: Record<string, (request: { payload: Record<string, unknown> }) => unknown> = {}) {
  const service: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of RENDERER_API_METHODS) service[method] = vi.fn().mockReturnValue(new Promise<never>(() => undefined));
  service["session.recover"] = vi.fn().mockResolvedValue(envelope("SUCCEEDED", "NONE", { outcome: "NONE", session_id: null, offline_valid_until: null, decision: null }));
  service["session.end"] = vi.fn().mockResolvedValue(envelope("SUCCEEDED", "ENDED", { outcome: "ENDED", session_id: SESSION }));
  for (const [method, implementation] of Object.entries(overrides)) service[method] = vi.fn(async (request) => implementation(request as { payload: Record<string, unknown> }));
  return service;
}

function install(service: Record<string, unknown>, search = "?login=required") {
  Object.defineProperty(window, "posService", { value: service, writable: true, configurable: true });
  window.history.replaceState(null, "", `/index.html${search}`);
}

beforeEach(() => { window.history.replaceState(null, "", "/index.html"); });
afterEach(() => { window.history.replaceState(null, "", "/index.html"); });

describe("loginRequired", () => {
  it("sólo con ?login=required", () => {
    expect(loginRequired("?login=required")).toBe(true);
    expect(loginRequired("")).toBe(false);
    expect(loginRequired("?login=optional")).toBe(false);
  });
});

describe("App con login exigido", () => {
  it("sin sesión en el equipo muestra la pantalla de login y no monta el POS", async () => {
    install(makeService());
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("login-name-input")).toBeTruthy());
    expect(screen.queryByTestId("app-sidebar")).toBeNull();
    expect(screen.queryByTestId("sale-panel")).toBeNull();
  });

  it("un login aceptado entra al POS; la contraseña viaja al servicio y no queda en la pantalla", async () => {
    const login = vi.fn((request: { payload: Record<string, unknown> }) => {
      expect(request.payload).toEqual({ login_name: "cajero1", password: "secreto largo de prueba", totp_code: null });
      return envelope("SUCCEEDED", "AUTHENTICATED", { outcome: "AUTHENTICATED", session_id: SESSION, offline_valid_until: UNTIL, decision: null, retry_at: null });
    });
    install(makeService({ "session.login": login }));
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("login-name-input")).toBeTruthy());
    fireEvent.change(screen.getByTestId("login-name-input"), { target: { value: " cajero1 " } });
    fireEvent.change(screen.getByTestId("login-password-input"), { target: { value: "secreto largo de prueba" } });
    await act(async () => { fireEvent.click(screen.getByTestId("login-submit-button")); });
    await waitFor(() => expect(screen.getByTestId("app-sidebar")).toBeTruthy());
    expect(login).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("operator-session")).toBeTruthy();
    expect(document.body.innerHTML).not.toContain("secreto largo de prueba");
  });

  it("un rechazo se explica en español y no entra", async () => {
    install(makeService({ "session.login": () => envelope("REJECTED", "REJECTED", { outcome: "REJECTED", session_id: null, offline_valid_until: null, decision: null, retry_at: null }) }));
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("login-name-input")).toBeTruthy());
    fireEvent.change(screen.getByTestId("login-name-input"), { target: { value: "cajero1" } });
    fireEvent.change(screen.getByTestId("login-password-input"), { target: { value: "mala" } });
    await act(async () => { fireEvent.click(screen.getByTestId("login-submit-button")); });
    await waitFor(() => expect(screen.getByTestId("login-error").textContent).toContain("Usuario o contraseña incorrectos"));
    expect(screen.queryByTestId("app-sidebar")).toBeNull();
    expect((screen.getByTestId("login-password-input") as HTMLInputElement).value).toBe("");
  });

  it("si la autoridad pide el código, aparece el campo y se envía con el siguiente intento", async () => {
    const calls: Array<Record<string, unknown>> = [];
    install(makeService({ "session.login": (request) => {
      calls.push(request.payload);
      return request.payload["totp_code"] === null
        ? envelope("REJECTED", "MFA_REQUIRED", { outcome: "MFA_REQUIRED", session_id: null, offline_valid_until: null, decision: null, retry_at: null })
        : envelope("SUCCEEDED", "AUTHENTICATED", { outcome: "AUTHENTICATED", session_id: SESSION, offline_valid_until: UNTIL, decision: null, retry_at: null });
    } }));
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("login-name-input")).toBeTruthy());
    fireEvent.change(screen.getByTestId("login-name-input"), { target: { value: "admin" } });
    fireEvent.change(screen.getByTestId("login-password-input"), { target: { value: "contraseña admin" } });
    await act(async () => { fireEvent.click(screen.getByTestId("login-submit-button")); });
    await waitFor(() => expect(screen.getByTestId("login-totp-input")).toBeTruthy());
    fireEvent.change(screen.getByTestId("login-password-input"), { target: { value: "contraseña admin" } });
    fireEvent.change(screen.getByTestId("login-totp-input"), { target: { value: "123456" } });
    await act(async () => { fireEvent.click(screen.getByTestId("login-submit-button")); });
    await waitFor(() => expect(screen.getByTestId("app-sidebar")).toBeTruthy());
    expect(calls.map((call) => call["totp_code"])).toEqual([null, "123456"]);
  });

  it("con sesión vigente en el equipo entra directo, y «Salir» cierra la sesión y vuelve al login", async () => {
    const service = makeService({ "session.recover": () => envelope("SUCCEEDED", "ACTIVE", { outcome: "ACTIVE", session_id: SESSION, offline_valid_until: UNTIL, decision: null }) });
    install(service);
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("logout-button")).toBeTruthy());
    await act(async () => { fireEvent.click(screen.getByTestId("logout-button")); });
    await waitFor(() => expect(screen.getByTestId("login-screen")).toBeTruthy());
    expect(service["session.end"]).toHaveBeenCalledTimes(1);
  });
});

describe("App sin login exigido", () => {
  it("se comporta como antes: el POS se monta y no hay pantalla de login ni botón de salir", () => {
    install(makeService(), "");
    render(<App />);
    expect(screen.getByTestId("app-sidebar")).toBeTruthy();
    expect(screen.queryByTestId("login-screen")).toBeNull();
    expect(screen.queryByTestId("logout-button")).toBeNull();
  });
});

describe("loginFailureMessage", () => {
  it("todo desenlace de rechazo del contrato tiene mensaje", () => {
    for (const outcome of SessionLoginOutcomeSchema.options.filter((value) => value !== "AUTHENTICATED")) {
      expect(loginFailureMessage({ outcome, decision: null, retryAt: null }), outcome).not.toBe("");
    }
  });
});

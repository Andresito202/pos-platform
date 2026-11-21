// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BusinessClient, BusinessHttpRejection } from "../../renderer/src/business-client.js";
import { AdministrativeControlPanel } from "../../renderer/src/components/AdministrativeControlPanel.js";
import { uuidV7 } from "@pos-platform/contracts";

vi.mock("../../renderer/src/business-client.js", async importOriginal => {
  const original = await importOriginal<typeof import("../../renderer/src/business-client.js")>();
  return { ...original, BusinessClient: class extends original.BusinessClient { constructor() { super("https://central.example.test"); } } };
});

const scope = { companyId: uuidV7(), branchId: uuidV7(), licenseId: uuidV7() };
const context = { ...scope, companyName: "Empresa Uno", branchName: "Centro", licenseName: "Comercial", currency: "COP" };
const register = { id: uuidV7(), tenant_id: uuidV7(), company_id: scope.companyId, branch_id: scope.branchId,
  code: "C1", code_normalized: "c1", name: "Caja principal", currency_code: "COP", status: "ACTIVE" as const,
  version: 7, created_at: new Date().toISOString(), retired_at: null };
// UI tests substitute the HTTPS client boundary. They do not prove server
// authorization, WebAuthn, persistence or live browser deployment.
beforeEach(() => {
  vi.spyOn(BusinessClient.prototype, "login").mockResolvedValue();
  vi.spyOn(BusinessClient.prototype, "contexts").mockResolvedValue({ contexts: [context], truncated: false });
  vi.spyOn(BusinessClient.prototype, "list").mockResolvedValue({ registers: [register], nextCursor: null });
  vi.spyOn(BusinessClient.prototype, "edit").mockResolvedValue(register);
  vi.spyOn(BusinessClient.prototype, "create").mockResolvedValue(register);
  vi.spyOn(BusinessClient.prototype, "retire").mockResolvedValue({ ...register, status: "RETIRED", version: 8, retired_at: new Date().toISOString() });
  vi.spyOn(BusinessClient.prototype, "logout").mockResolvedValue();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function open() {
  render(<AdministrativeControlPanel browserBusiness />);
  fireEvent.change(screen.getByLabelText("Correo"), { target: { value: "owner@example.test" } });
  fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "password-test-only" } });
  fireEvent.change(screen.getByLabelText("Organización"), { target: { value: uuidV7() } });
  fireEvent.change(screen.getByLabelText("Membresía"), { target: { value: uuidV7() } });
  fireEvent.click(screen.getByRole("button", { name: "Ingresar con autenticador" }));
  await screen.findByRole("combobox");
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "0" } });
  await screen.findByRole("button", { name: "Editar C1" });
}
describe("original administrative panel BUSINESS integration", () => {
  it("uses returned scope and existing version for edit and retire, then closes BUSINESS", async () => {
    await open(); expect(BusinessClient.prototype.list).toHaveBeenCalledWith(scope,null);
    fireEvent.click(screen.getByRole("button", { name: "Editar C1" }));
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Caja editada" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(BusinessClient.prototype.edit).toHaveBeenCalledWith(scope,register,"C1","Caja editada"));
    await waitFor(() => expect((screen.getByRole("button", { name: "Retirar C1" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Retirar C1" }));
    await waitFor(() => expect(BusinessClient.prototype.retire).toHaveBeenCalledWith(scope,register));
    await screen.findByRole("status");
    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión BUSINESS" }));
    await screen.findByRole("button", { name: "Ingresar con autenticador" });
    expect(BusinessClient.prototype.logout).toHaveBeenCalledOnce();
  });
  it("retains the creation identity after an uncertain network response", async () => {
    await open();
    vi.mocked(BusinessClient.prototype.create).mockRejectedValue(Error("Respuesta incierta"));
    // Keep authenticated state in this client boundary double.
    vi.spyOn(BusinessClient.prototype,"hasSession","get").mockReturnValue(true);
    fireEvent.change(screen.getByLabelText("Código"), { target: { value: "C2" } });
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Caja dos" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear caja" }));
    await screen.findByRole("alert");
    const first = vi.mocked(BusinessClient.prototype.create).mock.calls[0]![1];
    expect((screen.getByLabelText("Código") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(true);
    vi.mocked(BusinessClient.prototype.create).mockRejectedValue(new BusinessHttpRejection(409,"Rechazo después de una respuesta incierta"));
    fireEvent.click(screen.getByRole("button", { name: "Reintentar creación" }));
    await waitFor(() => expect(BusinessClient.prototype.create).toHaveBeenCalledTimes(2));
    expect(vi.mocked(BusinessClient.prototype.create).mock.calls[1]![1]).toEqual(first);
    expect((screen.getByLabelText("Código") as HTMLInputElement).disabled).toBe(true);
  });
  it("allows correction after a definitive first-attempt rejection",async()=>{
    await open();
    vi.spyOn(BusinessClient.prototype,"hasSession","get").mockReturnValue(true);
    vi.mocked(BusinessClient.prototype.create).mockRejectedValueOnce(new BusinessHttpRejection(409,"Código duplicado"));
    fireEvent.change(screen.getByLabelText("Código"),{target:{value:"C1"}});
    fireEvent.change(screen.getByLabelText("Nombre"),{target:{value:"Caja nueva"}});
    fireEvent.click(screen.getByRole("button",{name:"Crear caja"}));
    await screen.findByRole("alert");
    expect((screen.getByLabelText("Código") as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(false);
    expect((screen.getByRole("button",{name:"Editar C1"}) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Código"),{target:{value:"C2"}});
    fireEvent.click(screen.getByRole("button",{name:"Crear caja"}));
    await waitFor(()=>expect(BusinessClient.prototype.create).toHaveBeenLastCalledWith(scope,expect.objectContaining({code:"C2",name:"Caja nueva"})));
  });
  it("distinguishes licenses with the same plan name and sends the selected server context", async () => {
    const second={...context,licenseId:uuidV7()};
    vi.mocked(BusinessClient.prototype.contexts).mockResolvedValue({contexts:[context,second],truncated:false});
    await open();
    expect(screen.getByRole("option",{name:new RegExp(context.licenseId)})).toBeTruthy();
    expect(screen.getByRole("option",{name:new RegExp(second.licenseId)})).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox"),{target:{value:"1"}});
    const selected={...scope,licenseId:second.licenseId};
    await waitFor(()=>expect(BusinessClient.prototype.list).toHaveBeenLastCalledWith(selected,null));
    fireEvent.change(screen.getByLabelText("Código"),{target:{value:"C2"}});
    fireEvent.change(screen.getByLabelText("Nombre"),{target:{value:"Caja dos"}});
    fireEvent.click(screen.getByRole("button",{name:"Crear caja"}));
    await waitFor(()=>expect(BusinessClient.prototype.create).toHaveBeenCalledWith(selected,expect.objectContaining({code:"C2",name:"Caja dos",currency:"COP"})));
  });

});

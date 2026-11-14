// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { uuidV7 } from "@pos-platform/contracts";
import { PlatformClient, PlatformRequestError } from "../../renderer/src/platform-client.js";
import { PlatformLicenseFulfillment } from "../../renderer/src/components/PlatformLicenseFulfillment.js";
const request = () => ({ license_id: uuidV7(), credential_id: uuidV7(), allocations: [{ branch_id: uuidV7(), register_id: uuidV7() }], idempotency_key: uuidV7(), correlation_id: uuidV7() });
function fill(r: ReturnType<typeof request>) {
  for (const [label, value] of [["Licencia a asignar",r.license_id],["Credencial del dispositivo",r.credential_id],["Sucursal 1",r.allocations[0]!.branch_id],["Caja 1",r.allocations[0]!.register_id]]) {
    fireEvent.change(screen.getByLabelText(label!), { target: { value } });
  }
  fireEvent.click(screen.getByRole("button", { name: "Revisar asignación" }));
}
describe("GLOBAL license fulfillment", () => {
  it("loads real company/branch options and clears them when license changes", async () => {
    const r=request(),context={licenseId:r.license_id,company:{id:uuidV7(),name:"Comercio Real"},branches:[{id:r.allocations[0]!.branch_id,name:"Sucursal Norte"}],credentials:[{id:r.credential_id,deviceId:uuidV7(),expiresAt:"2027-01-01T00:00:00Z"}],branchesTruncated:false,credentialsTruncated:false};
    const client={assignmentContext:vi.fn().mockResolvedValue(context),issueLicense:vi.fn(),allocateLicense:vi.fn()};
    render(<PlatformLicenseFulfillment client={client as unknown as PlatformClient}/>);
    fireEvent.change(screen.getByLabelText("Licencia a asignar"),{target:{value:r.license_id}});
    fireEvent.click(screen.getByRole("button",{name:"Cargar empresa y dispositivos"}));
    await screen.findByText("Comercio Real");expect(client.assignmentContext).toHaveBeenCalledWith(r.license_id);
    fireEvent.change(screen.getByLabelText("Dispositivo registrado"),{target:{value:r.credential_id}});
    fireEvent.change(screen.getByLabelText("Sucursal 1"),{target:{value:r.allocations[0]!.branch_id}});
    expect(screen.getByRole("option",{name:/Sucursal Norte/})).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Licencia a asignar"),{target:{value:uuidV7()}});
    expect(screen.queryByText("Comercio Real")).toBeNull();
    expect((screen.getByLabelText("Credencial del dispositivo") as HTMLInputElement).value).toBe("");
    expect(client.allocateLicense).not.toHaveBeenCalled();
  });
  it("keeps four successive license assignments separate in the same panel", async () => {
    const requests = Array.from({ length: 4 }, request);
    const client = {
      assignmentContext: vi.fn(async (id: string) => {
        const index = requests.findIndex(item => item.license_id === id);
        const item = requests[index]!;
        return { licenseId: id, company: { id: uuidV7(), name: `Empresa ${index + 1}` },
          branches: [{ id: item.allocations[0]!.branch_id, name: `Sucursal ${index + 1}` }],
          credentials: [{ id: item.credential_id, deviceId: uuidV7(), expiresAt: "2027-01-01T00:00:00Z" }],
          branchesTruncated: false, credentialsTruncated: false };
      }),
      issueLicense: vi.fn(),
      allocateLicense: vi.fn<PlatformClient["allocateLicense"]>().mockResolvedValue({ activationId: uuidV7(), status: "PENDING" }),
    };
    render(<PlatformLicenseFulfillment client={client as unknown as PlatformClient} />);
    for (const [index, item] of requests.entries()) {
      fireEvent.change(screen.getByLabelText("Licencia a asignar"), { target: { value: item.license_id } });
      expect((screen.getByLabelText("Credencial del dispositivo") as HTMLInputElement).value).toBe("");
      expect((screen.getByLabelText("Caja 1") as HTMLInputElement).value).toBe("");
      fireEvent.click(screen.getByRole("button", { name: "Cargar empresa y dispositivos" }));
      await screen.findByText(`Empresa ${index + 1}`);
      fireEvent.change(screen.getByLabelText("Dispositivo registrado"), { target: { value: item.credential_id } });
      fireEvent.change(screen.getByLabelText("Sucursal 1"), { target: { value: item.allocations[0]!.branch_id } });
      fireEvent.change(screen.getByLabelText("Caja 1"), { target: { value: item.allocations[0]!.register_id } });
      fireEvent.click(screen.getByRole("button", { name: "Revisar asignación" }));
      fireEvent.click(screen.getByRole("checkbox"));
      fireEvent.click(screen.getByRole("button", { name: "Confirmar asignación en Central" }));
      await waitFor(() => expect(client.allocateLicense).toHaveBeenCalledTimes(index + 1));
      await screen.findByText(/Activación:/);
      expect(client.allocateLicense.mock.calls[index]![0]).toMatchObject({
        license_id: item.license_id, credential_id: item.credential_id, allocations: item.allocations,
      });
      fireEvent.click(screen.getByRole("button", { name: "Volver a los datos" }));
    }
    const keys = client.allocateLicense.mock.calls.map(call => call[0].idempotency_key);
    expect(new Set(keys).size).toBe(4);
  });
  it("rejects assignment options for another license and invalid input before transport", async () => {
    const licenseId=uuidV7(),fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({licenseId:uuidV7(),company:{id:uuidV7(),name:"Other"},branches:[],credentials:[],branchesTruncated:false,credentialsTruncated:false})));
    const client=new PlatformClient({protocol:"https:",origin:"https://central.example.test"},fetcher);
    await expect(client.assignmentContext("invalid")).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
    await expect(client.assignmentContext(licenseId)).rejects.toThrow("otra licencia");
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toEqual({licenseId});
  });
  it("uses exact authoritative endpoints and rejects invalid input/results", async () => {
    const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ licenseId:uuidV7(),contractStatus:"ACTIVE",activationStatus:"NOT_ACTIVATED",idempotent:false })));
    const client=new PlatformClient({protocol:"https:",origin:"https://central.example.test"},fetcher);
    const payment=uuidV7(),correlation=uuidV7();await client.issueLicense(payment,correlation);
    expect(fetcher.mock.calls[0]![0]).toBe("https://central.example.test/v1/platform/licenses/issue");
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toEqual({paymentId:payment,correlationId:correlation});
    const r=request();fetcher.mockResolvedValue(new Response(JSON.stringify({activationId:uuidV7(),status:"PENDING",idempotent:false})));
    expect((await client.allocateLicense(r)).status).toBe("PENDING");
    expect(JSON.parse(String(fetcher.mock.calls[1]![1]!.body))).toEqual(r);
    await expect(client.allocateLicense({...r,allocations:[r.allocations[0],r.allocations[0]]})).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockResolvedValue(new Response(JSON.stringify({activationId:uuidV7(),status:"COMPLETE",idempotent:false})));
    await expect(client.allocateLicense(r)).rejects.toThrow("no confirmó");
  });
  it("requires explicit confirmation and retries identical request after uncertain transport", async () => {
    const client={issueLicense:vi.fn(),allocateLicense:vi.fn().mockRejectedValueOnce(Error("Sin respuesta")).mockResolvedValue({activationId:uuidV7(),status:"PENDING",idempotent:true})};
    render(<PlatformLicenseFulfillment client={client as unknown as PlatformClient}/>);fill(request());
    expect(client.allocateLicense).not.toHaveBeenCalled();
    expect(screen.getByRole("button",{name:"Confirmar asignación en Central"}).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByRole("button",{name:"Confirmar asignación en Central"}));
    await screen.findByRole("alert");
    expect(screen.getByRole("button",{name:"Volver a los datos"}).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button",{name:"Confirmar asignación en Central"}));
    await screen.findByText(/aún debe acreditar posesión/);
    expect(client.allocateLicense.mock.calls[1]![0]).toEqual(client.allocateLicense.mock.calls[0]![0]);
  });
  it("allows corrections on explicit backend rejection, without a success message", async () => {
    const client={issueLicense:vi.fn(),allocateLicense:vi.fn().mockRejectedValue(new PlatformRequestError("Rechazado",400))};
    render(<PlatformLicenseFulfillment client={client as unknown as PlatformClient}/>);fill(request());
    fireEvent.click(screen.getByRole("checkbox"));fireEvent.click(screen.getByRole("button",{name:"Confirmar asignación en Central"}));
    await screen.findByRole("alert");
    expect(screen.getByRole("button",{name:"Volver a los datos"}).hasAttribute("disabled")).toBe(false);
    expect(screen.queryByText(/Estado confirmado por Central/)).toBeNull();
  });
  it("coalesces double clicks for issuance and does not call issuance when reviewing an allocation", async () => {
    let finish!: (v: unknown)=>void;
    const client={issueLicense:vi.fn(()=>new Promise(resolve=>{finish=resolve;})),allocateLicense:vi.fn()};
    render(<PlatformLicenseFulfillment client={client as unknown as PlatformClient}/>);
    fireEvent.change(screen.getByLabelText("Pago confirmado"),{target:{value:uuidV7()}});
    const button=screen.getByRole("button",{name:"Emitir o recuperar licencia del pago"});fireEvent.click(button);fireEvent.click(button);
    expect(client.issueLicense).toHaveBeenCalledTimes(1);
    await act(async()=>{finish({licenseId:uuidV7(),contractStatus:"ACTIVE",idempotent:false});});
    await waitFor(()=>expect(screen.getByText(/Contrato emitido/)).toBeTruthy());
    expect(client.allocateLicense).not.toHaveBeenCalled();
  });
});

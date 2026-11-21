// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PlatformClient } from "../../renderer/src/platform-client.js";
import { PlatformTenantRegistration } from "../../renderer/src/components/PlatformTenantRegistration.js";
import { uuidV7 } from "@pos-platform/contracts";
afterEach(cleanup);
describe("original GLOBAL tenant registration with HTTPS transport double", () => {
  it("retains the full onboarding request on retry and exposes the confirmed membership", async () => {
    const result = { onboardingId:uuidV7(),tenantId:uuidV7(),companyId:uuidV7(),branchId:uuidV7(),ownerUserId:uuidV7(),tenantMembershipId:uuidV7(),status:"READY_FOR_LICENSE" };
    const transport = vi.fn<typeof fetch>().mockRejectedValueOnce(Error("Lost response")).mockResolvedValueOnce(new Response(JSON.stringify(result),{status:200}));
    const client = new PlatformClient({protocol:"https:",origin:"https://central.example.test"},transport);
    render(<PlatformTenantRegistration client={client}/>);
    for (const [label,value] of [["Nombre del negocio","Empresa"],["Nombre comercial","Empresa SAS"],["Sucursal principal","Centro"],["Nombre del propietario","Propietario"],["Correo del propietario","owner@example.test"]]) {
      fireEvent.change(screen.getByLabelText(label!),{target:{value}});
    }
    fireEvent.click(screen.getByRole("button",{name:"Registrar empresa"}));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button",{name:"Reintentar registro"}));
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain(result.tenantId); expect(status.textContent).toContain(result.tenantMembershipId);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls[0]![0]).toBe("https://central.example.test/v1/platform/tenants/initialize");
    expect(transport.mock.calls[1]![1]?.body).toBe(transport.mock.calls[0]![1]?.body);
  });
});

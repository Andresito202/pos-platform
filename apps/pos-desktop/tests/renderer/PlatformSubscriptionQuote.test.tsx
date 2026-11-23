// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,describe,expect,it,vi} from "vitest";
import {PlatformSubscriptionQuote} from "../../renderer/src/components/PlatformSubscriptionQuote.js";
import type {PlatformClient,PublishedOffer} from "../../renderer/src/platform-client.js";
import {uuidV7} from "@pos-platform/contracts";

afterEach(()=>cleanup());

const offer={
  id:uuidV7(),code:"CAMACHO_MONTHLY",name:"Mensual",billing_model:"MONTHLY",deployment_mode:"HYBRID",
  currency_code:"COP",currency_exponent:2,price_minor:4_990_000,included_registers:1,
  additional_register_price_minor:1_990_000,support_price_minor:1_490_000,
  support_charge:"OPTIONAL_SAME_TERM",support_term_months:1,policy_reference:"OWNER_PREPRODUCTION_2026_10_28",
  profile:"CAMACHO_LICENSE_OFFER_V2",publication_scope:"PREPRODUCTION",
  version:2,status:"ACTIVE",published_at:"2026-11-01T00:00:00.000Z",
} as PublishedOffer;

describe("PlatformSubscriptionQuote",()=>{
  it("opens a catalog quote and auto-issues after Factus verification",async()=>{
    const paymentId=uuidV7();
    const licenseId=uuidV7();
    const createSubscriptionQuote=vi.fn(async()=>({
      quoteId:uuidV7(),paymentId,totalMinor:4_990_000,currencyCode:"COP" as const,
      expiresAt:"2026-11-24T00:00:00.000Z",quoteChecksum:"b".repeat(64),
      providerReference:uuidV7(),providerOpenStatus:"OPENED" as const,qr:null,
      paymentStatus:"PENDING" as const,idempotent:false,
    }));
    const verifySubscriptionPayment=vi.fn(async(request:{payment_id:string})=>({
      paymentId:request.payment_id,quoteId:uuidV7(),status:"CONFIRMED" as const,
      source:"FACTUS_PAY_GET",idempotent:false,reconciliation:null,
      licenseId,contractStatus:"ACTIVE",activationStatus:"NOT_ACTIVATED" as const,licenseIdempotent:false,
    }));
    const listPendingSubscriptionPayments=vi.fn(async()=>[]);
    const client={createSubscriptionQuote,verifySubscriptionPayment,listPendingSubscriptionPayments} as unknown as PlatformClient;
    render(<PlatformSubscriptionQuote client={client} offers={[offer]}/>);

    fireEvent.change(screen.getByLabelText("Tenant del cliente"),{target:{value:uuidV7()}});
    fireEvent.change(screen.getByLabelText("Empresa del cliente"),{target:{value:uuidV7()}});
    fireEvent.change(screen.getByLabelText("Plan publicado"),{target:{value:offer.id}});
    fireEvent.click(screen.getByRole("button",{name:"Abrir cotización"}));

    await waitFor(()=>expect(createSubscriptionQuote).toHaveBeenCalledOnce());
    expect(screen.queryByLabelText(/Referencia de evidencia/i)).toBeNull();
    expect(screen.getByText(/simulador oficial de FACTUS exige cámara/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button",{name:"Verificar cobro y emitir licencia"}));
    await waitFor(()=>expect(verifySubscriptionPayment).toHaveBeenCalledOnce());
    expect(screen.getByText(new RegExp(`Licencia ${licenseId}`))).toBeTruthy();
    expect(screen.getByText(/Activación del dispositivo: NOT_ACTIVATED/i)).toBeTruthy();
  });

  it("recovers a pending collection QR through the authenticated GLOBAL client",async()=>{
    const paymentId=uuidV7();
    const recoverSubscriptionCollection=vi.fn(async()=>({
      paymentId,quoteId:uuidV7(),tenantId:uuidV7(),companyId:uuidV7(),
      providerReference:uuidV7(),amountScale6:"49900.000000",totalMinor:4_990_000,
      currencyCode:"COP" as const,status:"ready",qr:"data:image/png;base64,qqqq",
      paid:false,expiresAt:"2026-11-24T00:00:00.000Z",
    }));
    const listPendingSubscriptionPayments=vi.fn(async()=>[{
      quoteId:uuidV7(),paymentId,tenantId:uuidV7(),companyId:uuidV7(),
      totalMinor:4_990_000,currencyCode:"COP" as const,expiresAt:"2026-11-24T00:00:00.000Z",
      planId:offer.id,planVersion:2,providerReference:uuidV7(),paymentStatus:"PENDING" as const,
    }]);
    const client={
      createSubscriptionQuote:vi.fn(),verifySubscriptionPayment:vi.fn(),
      listPendingSubscriptionPayments,recoverSubscriptionCollection,
    } as unknown as PlatformClient;
    render(<PlatformSubscriptionQuote client={client} offers={[offer]}/>);
    await waitFor(()=>expect(screen.getByRole("button",{name:"Recuperar QR"})).toBeTruthy());
    fireEvent.click(screen.getByRole("button",{name:"Recuperar QR"}));
    await waitFor(()=>expect(recoverSubscriptionCollection).toHaveBeenCalledOnce());
    expect(screen.getByAltText("QR de cobro FACTUS Pay")).toBeTruthy();
    expect(screen.getByRole("button",{name:"Descargar QR PNG"})).toBeTruthy();
  });

  it("keeps payment pending when Factus Pay is not configured",async()=>{
    const createSubscriptionQuote=vi.fn(async()=>({
      quoteId:uuidV7(),paymentId:uuidV7(),totalMinor:4_990_000,currencyCode:"COP" as const,
      expiresAt:"2026-11-24T00:00:00.000Z",quoteChecksum:"b".repeat(64),
      providerReference:uuidV7(),providerOpenStatus:"NOT_CONFIGURED" as const,qr:null,
      paymentStatus:"PENDING" as const,idempotent:false,
    }));
    const verifySubscriptionPayment=vi.fn(async()=>{throw Error("El cobro sigue pendiente en el proveedor. No se emite licencia sin pago verificado.");});
    const listPendingSubscriptionPayments=vi.fn(async()=>[]);
    const client={createSubscriptionQuote,verifySubscriptionPayment,listPendingSubscriptionPayments} as unknown as PlatformClient;
    render(<PlatformSubscriptionQuote client={client} offers={[offer]}/>);
    fireEvent.change(screen.getByLabelText("Tenant del cliente"),{target:{value:uuidV7()}});
    fireEvent.change(screen.getByLabelText("Empresa del cliente"),{target:{value:uuidV7()}});
    fireEvent.change(screen.getByLabelText("Plan publicado"),{target:{value:offer.id}});
    fireEvent.click(screen.getByRole("button",{name:"Abrir cotización"}));
    await waitFor(()=>expect(screen.getByText(/proveedor no configurado/i)).toBeTruthy());
    fireEvent.click(screen.getByRole("button",{name:"Verificar cobro y emitir licencia"}));
    await waitFor(()=>expect(screen.getByRole("alert").textContent).toMatch(/no se emite licencia/i));
  });
});

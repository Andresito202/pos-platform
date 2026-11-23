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
  it("opens a catalog quote and confirms payment evidence without inventing amounts",async()=>{
    const createSubscriptionQuote=vi.fn(async()=>({
      quoteId:uuidV7(),paymentId:uuidV7(),totalMinor:4_990_000,currencyCode:"COP" as const,
      expiresAt:"2026-11-24T00:00:00.000Z",quoteChecksum:"b".repeat(64),idempotent:false,
    }));
    const confirmSubscriptionPayment=vi.fn(async(request:{payment_id:string})=>({
      paymentId:request.payment_id,quoteId:uuidV7(),status:"CONFIRMED" as const,idempotent:false,
    }));
    const client={createSubscriptionQuote,confirmSubscriptionPayment} as unknown as PlatformClient;
    render(<PlatformSubscriptionQuote client={client} offers={[offer]}/>);

    fireEvent.change(screen.getByLabelText("Tenant del cliente"),{target:{value:uuidV7()}});
    fireEvent.change(screen.getByLabelText("Empresa del cliente"),{target:{value:uuidV7()}});
    fireEvent.change(screen.getByLabelText("Plan publicado"),{target:{value:offer.id}});
    fireEvent.click(screen.getByRole("button",{name:"Abrir cotización y cobro"}));

    await waitFor(()=>expect(createSubscriptionQuote).toHaveBeenCalledOnce());
    const body=createSubscriptionQuote.mock.calls.at(0)?.at(0) as unknown as {
      plan_id:string;plan_version:number;selection:unknown;
    };
    expect(body.plan_id).toBe(offer.id);
    expect(body.plan_version).toBe(2);
    expect(body.selection).toEqual({additional_registers:0,support:false});
    expect(body).not.toHaveProperty("total_minor");

    fireEvent.change(screen.getByLabelText("Referencia de evidencia de pago"),{target:{value:"TRANSFER-001"}});
    fireEvent.click(screen.getByRole("button",{name:"Confirmar evidencia en Central"}));
    await waitFor(()=>expect(confirmSubscriptionPayment).toHaveBeenCalledOnce());
    expect(screen.getByText(/Pago .+ confirmado/i)).toBeTruthy();
  });
});

// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,describe,expect,it,vi} from "vitest";
import {PlatformOfferEditor} from "../../renderer/src/components/PlatformOfferEditor.js";
import type {PlatformClient,PublishedOffer} from "../../renderer/src/platform-client.js";
import {CASH_REGISTER_ENTITLEMENT,LicenseSectorEntitlement,uuidV7} from "@pos-platform/contracts";

afterEach(()=>cleanup());

const draft={
  id:uuidV7(),code:"CAMACHO_MONTHLY",name:"Mensual",billing_model:"MONTHLY",deployment_mode:"HYBRID",
  currency_code:"COP",currency_exponent:2,price_minor:4_990_000,included_registers:1,
  additional_register_price_minor:1_990_000,support_price_minor:1_490_000,
  support_charge:"OPTIONAL_SAME_TERM",support_term_months:1,policy_reference:"OWNER_PREPRODUCTION_2026_10_28",
  profile:"CAMACHO_LICENSE_OFFER_V2",publication_scope:"PREPRODUCTION",
  version:3,status:"DRAFT" as const,published_at:null,
  features:[
    {capability_code:CASH_REGISTER_ENTITLEMENT,enabled:true,limit_type:"NOT_APPLICABLE",limit_value:null},
    {capability_code:LicenseSectorEntitlement.FARMACIA,enabled:true,limit_type:"NOT_APPLICABLE",limit_value:null},
  ],
} as PublishedOffer;

describe("PlatformOfferEditor entitlements sync",()=>{
  it("loads persisted sector modules when selecting a draft",()=>{
    const client={setEntitlements:vi.fn()} as unknown as PlatformClient;
    render(<PlatformOfferEditor client={client} offers={[draft]} onChanged={async()=>{}}/>);
    fireEvent.click(screen.getByRole("button",{name:/Revisar y editar Mensual/i}));
    const farmacia=screen.getByLabelText("Farmacia") as HTMLInputElement;
    const pasteleria=screen.getByLabelText("Pastelería") as HTMLInputElement;
    expect(farmacia.checked).toBe(true);
    expect(pasteleria.checked).toBe(false);
  });

  it("keeps draft version and sectors synchronized after saving entitlements",async()=>{
    const setEntitlements=vi.fn(async()=>({
      planId:draft.id,version:3,
      entitlements:[CASH_REGISTER_ENTITLEMENT,LicenseSectorEntitlement.FARMACIA,LicenseSectorEntitlement.PASTELERIA],
    }));
    const onChanged=vi.fn(async()=>{});
    const client={setEntitlements} as unknown as PlatformClient;
    render(<PlatformOfferEditor client={client} offers={[draft]} onChanged={onChanged}/>);
    fireEvent.click(screen.getByRole("button",{name:/Revisar y editar Mensual/i}));
    fireEvent.click(screen.getByLabelText("Pastelería"));
    fireEvent.click(screen.getByRole("button",{name:"Guardar módulos en borrador"}));
    await waitFor(()=>expect(setEntitlements).toHaveBeenCalledOnce());
    expect(setEntitlements.mock.calls.at(0)?.slice(0,3)).toEqual([
      draft.id,3,[CASH_REGISTER_ENTITLEMENT,LicenseSectorEntitlement.FARMACIA,LicenseSectorEntitlement.PASTELERIA],
    ]);
    await waitFor(()=>expect(onChanged).toHaveBeenCalledOnce());
    expect((screen.getByLabelText("Pastelería") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("status").textContent).toMatch(/Central guardó POS base/i);
  });
});

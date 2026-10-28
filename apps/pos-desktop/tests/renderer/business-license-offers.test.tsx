// @vitest-environment jsdom
import {it,expect,vi,afterEach} from "vitest";
import {render,screen,waitFor,cleanup} from "@testing-library/react";
import {BusinessLicenseOffers} from "../../renderer/src/components/BusinessLicenseOffers.js";
import {uuidV7} from "@pos-platform/contracts";
afterEach(cleanup);
it("business admin uses existing read channel and displays backend prices without a GLOBAL editor",async()=>{
  const read=vi.fn().mockResolvedValue({status:"SUCCEEDED",result:{outcome:"AVAILABLE",catalog:{profile:"CAMACHO_PUBLIC_LICENSE_CATALOG_V1",offers:[{
    id:uuidV7(),code:"CAMACHO_MONTHLY",name:"Mensual",billing_model:"MONTHLY",deployment_mode:"HYBRID",currency_code:"COP",currency_exponent:2,
    price_minor:5990000,included_registers:1,additional_register_price_minor:1990000,support_price_minor:1490000,support_charge:"OPTIONAL_SAME_TERM",support_term_months:1,
    policy_reference:"TEST_ONLY",profile:"CAMACHO_LICENSE_OFFER_V2",publication_scope:"PREPRODUCTION",version:2,status:"ACTIVE",published_at:"2026-10-28T12:00:00.000Z",tax_status:"PENDING",purchase_enabled:false,
  }]}}});
  Object.defineProperty(window,"posService",{configurable:true,value:{"license.offers.list":read}});
  render(<BusinessLicenseOffers/>);await waitFor(()=>expect(screen.getByText("$ 59.900 COP")).toBeTruthy());
  expect(read).toHaveBeenCalledTimes(1);expect(read.mock.calls[0]![0]).toMatchObject({message_type:"license.offers.list",payload:{}});
  expect(screen.queryByText("Guardar borrador")).toBeNull();expect(screen.getByText(/no modifican tu contrato/)).toBeTruthy();
});

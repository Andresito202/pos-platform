// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,describe,expect,it,vi} from "vitest";
import {PlatformBankManualConfirm} from "../../renderer/src/components/PlatformBankManualConfirm.js";
import type {PlatformClient} from "../../renderer/src/platform-client.js";
import {uuidV7} from "@pos-platform/contracts";

afterEach(()=>cleanup());

describe("PlatformBankManualConfirm",()=>{
  it("requires bank-account attestation and rejects client-receipt-only confirmation",async()=>{
    const paymentId=uuidV7();
    const listPendingSubscriptionPayments=vi.fn(async()=>[{
      quoteId:uuidV7(),paymentId,tenantId:uuidV7(),companyId:uuidV7(),
      totalMinor:4_990_000,currencyCode:"COP" as const,expiresAt:"2026-11-24T00:00:00.000Z",
      planId:uuidV7(),planVersion:2,providerReference:uuidV7(),paymentStatus:"PENDING" as const,
    }]);
    const confirmBankManualSubscriptionPayment=vi.fn();
    const client={listPendingSubscriptionPayments,confirmBankManualSubscriptionPayment} as unknown as PlatformClient;
    render(<PlatformBankManualConfirm client={client}/>);
    await waitFor(()=>expect(listPendingSubscriptionPayments).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Cotización pendiente"),{target:{value:paymentId}});
    fireEvent.change(screen.getByLabelText("Referencia bancaria"),{target:{value:"TRF-001"}});
    fireEvent.change(screen.getByLabelText("Banco receptor"),{target:{value:"Bancolombia"}});
    fireEvent.change(screen.getByLabelText("Fecha y hora del abono"),{target:{value:"2026-11-23T10:00"}});
    fireEvent.change(screen.getByLabelText("Motivo de la excepción"),{target:{value:"Factus Pay no responde"}});
    fireEvent.change(screen.getByLabelText("Observación de la cuenta receptora"),{target:{value:"Abono visto en extracto de la cuenta receptora"}});
    const submit=screen.getByRole("button",{name:"Confirmar consignación y emitir licencia"});
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(submit);
    expect(confirmBankManualSubscriptionPayment).not.toHaveBeenCalled();
  });

  it("submits attested bank confirmation and shows issued license not device activation",async()=>{
    const paymentId=uuidV7();
    const licenseId=uuidV7();
    const listPendingSubscriptionPayments=vi.fn(async()=>[{
      quoteId:uuidV7(),paymentId,tenantId:uuidV7(),companyId:uuidV7(),
      totalMinor:4_990_000,currencyCode:"COP" as const,expiresAt:"2026-11-24T00:00:00.000Z",
      planId:uuidV7(),planVersion:2,providerReference:uuidV7(),paymentStatus:"PENDING" as const,
    }]);
    const confirmBankManualSubscriptionPayment=vi.fn(async()=>({
      paymentId,quoteId:uuidV7(),status:"CONFIRMED" as const,source:"BANK_MANUAL_VERIFIED" as const,
      idempotent:false,licenseId,contractStatus:"ACTIVE",activationStatus:"NOT_ACTIVATED" as const,
      licenseIdempotent:false,
    }));
    const client={listPendingSubscriptionPayments,confirmBankManualSubscriptionPayment} as unknown as PlatformClient;
    render(<PlatformBankManualConfirm client={client}/>);
    await waitFor(()=>expect(listPendingSubscriptionPayments).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText("Cotización pendiente"),{target:{value:paymentId}});
    fireEvent.change(screen.getByLabelText("Referencia bancaria"),{target:{value:"TRF-991"}});
    fireEvent.change(screen.getByLabelText("Banco receptor"),{target:{value:"Bancolombia"}});
    fireEvent.change(screen.getByLabelText("Fecha y hora del abono"),{target:{value:"2026-11-23T10:00"}});
    fireEvent.change(screen.getByLabelText("Motivo de la excepción"),{target:{value:"Proveedor indisponible tras timeout"}});
    fireEvent.change(screen.getByLabelText("Observación de la cuenta receptora"),{target:{value:"Abono COP coincidente visto en banca en línea receptora"}});
    fireEvent.click(screen.getByText(/verifiqué el abono directamente/i));
    fireEvent.click(screen.getByText(/comprobante del cliente no es verificación suficiente/i));
    fireEvent.click(screen.getByRole("button",{name:"Confirmar consignación y emitir licencia"}));
    await waitFor(()=>expect(confirmBankManualSubscriptionPayment).toHaveBeenCalledOnce());
    const body=confirmBankManualSubscriptionPayment.mock.calls.at(0)?.at(0) as unknown as {
      bank_account_verified:boolean;customer_receipt_insufficient_acknowledged:boolean;amount_minor:number;
    };
    expect(body.bank_account_verified).toBe(true);
    expect(body.customer_receipt_insufficient_acknowledged).toBe(true);
    expect(body.amount_minor).toBe(4_990_000);
    expect(screen.getByText(new RegExp(`Licencia ${licenseId}`))).toBeTruthy();
    expect(screen.getByText(/Activación del dispositivo: NOT_ACTIVATED/i)).toBeTruthy();
  });
});

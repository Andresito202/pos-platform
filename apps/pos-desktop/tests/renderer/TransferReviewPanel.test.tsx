// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TransferReviewPanel } from "../../renderer/src/components/TransferReviewPanel.js";

vi.mock("../../renderer/src/confirmation-sound.js", () => ({ shouldPlayChime: () => false, playConfirmationChime: vi.fn() }));
const id = "77777777-7777-4777-8777-777777777777";
const ok = (result: Record<string, unknown>) => ({ status: "SUCCEEDED", result_code: result.outcome, result });
const found = (status = "CREATED") => ok({ outcome: "FOUND", payment_id: id,
  sale_id: "55555555-5555-4555-8555-555555555555", method: "TRANSFER", status,
  expected_amount: "3500.000000", confirmed_amount: null, currency_code: "COP", version: 7 });
const permissions = new Set(["PAYMENTS_PAYMENT_READ", "PAYMENTS_TRANSFER_CONFIRM", "PAYMENTS_PAYMENT_CANCEL"]);
let service: Record<string, ReturnType<typeof vi.fn>>;
beforeEach(() => {
  service = {
    "payment.get": vi.fn().mockResolvedValue(found()),
    "payment.transfer.confirm": vi.fn().mockResolvedValue(ok({ outcome: "CONFIRMED", payment_id: id,
      sale_completed: true, confirmed_coverage: "3500.000000", payable_amount: "3500.000000" })),
    "payment.cancel": vi.fn().mockResolvedValue(ok({ outcome: "CANCELLED", payment_id: id })),
    "catalog.item.list": vi.fn(), "sale.create": vi.fn(), "cash.shift.open": vi.fn(),
  };
  Object.defineProperty(window, "posService", { value: service, configurable: true });
});
async function lookup() {
  fireEvent.change(screen.getByLabelText("Referencia del pago"), { target: { value: id } });
  fireEvent.click(screen.getByRole("button", { name: "Consultar transferencia" }));
  await screen.findByText("$3.500");
}
describe("transfer supervision without cashier workspace", () => {
  it("queries and confirms with the server version, without creating a sale or loading a catalog", async () => {
    render(<TransferReviewPanel permissions={permissions} />);
    await lookup();
    expect(screen.queryByTestId("cart")).toBeNull();
    expect(screen.getByText("Importe reportado")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar ingreso verificado" }));
    await screen.findByText("Venta pagada por completo.");
    expect(service["payment.transfer.confirm"]).toHaveBeenCalledWith(expect.objectContaining({
      payload: { payment_id: id, expected_version: 7 },
    }));
    for (const name of ["catalog.item.list", "sale.create", "cash.shift.open"]) expect(service[name]).not.toHaveBeenCalled();
  });
  it("cancels a pending payment using its loaded version and refreshes its state", async () => {
    service["payment.get"]!.mockResolvedValueOnce(found()).mockResolvedValue(found("CANCELLED"));
    render(<TransferReviewPanel permissions={permissions} />);
    await lookup();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar pago pendiente" }));
    await screen.findByText("Cancelada");
    expect(service["payment.cancel"]).toHaveBeenCalledWith(expect.objectContaining({ payload: { payment_id: id, expected_version: 7 } }));
  });
  it("does not offer confirmation or cancellation of an already confirmed payment", async () => {
    service["payment.get"]!.mockResolvedValue(found("CONFIRMED"));
    render(<TransferReviewPanel permissions={permissions} />);
    await lookup();
    expect((screen.getByRole("button", { name: "Confirmar ingreso verificado" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancelar pago pendiente" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("does not offer mutation controls to read-only permissions", async () => {
    render(<TransferReviewPanel permissions={new Set(["PAYMENTS_PAYMENT_READ"])} />);
    await lookup();
    expect(screen.queryByRole("button", { name: "Confirmar ingreso verificado" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancelar pago pendiente" })).toBeNull();
    await waitFor(() => expect(service["payment.get"]).toHaveBeenCalledTimes(1));
  });
});

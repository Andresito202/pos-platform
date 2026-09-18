import { describe, expect, it } from "vitest";
import { buildWompiWebCheckout } from "./wompi-checkout-builder.js";

const credentials = {
  publicKey: "pub_test_X0zDA9xoKdePzhd8a0x9HAez7HgGO2fH",
  integritySecret: "prod_integrity_test_secret",
};

function intent(amount: string) {
  return {
    paymentId: "payment-1",
    saleId: "sale-1",
    tenantId: "tenant-1",
    branchId: "branch-1",
    cashRegisterId: "register-1",
    amount,
    currencyCode: "COP" as const,
    idempotencyKey: "idempotency-1",
  };
}

describe("Wompi Web Checkout builder", () => {
  it("converts scale-6 COP money to exact centavos and signs the checkout", () => {
    const checkout = buildWompiWebCheckout(
      {
        intent: intent("24900.000000"),
        providerReference: "ORDER-249",
      },
      credentials,
    );

    const url = new URL(checkout.url);
    expect(url.origin + url.pathname).toBe("https://checkout.wompi.co/p/");
    expect(url.searchParams.get("public-key")).toBe(credentials.publicKey);
    expect(url.searchParams.get("currency")).toBe("COP");
    expect(url.searchParams.get("amount-in-cents")).toBe("2490000");
    expect(url.searchParams.get("reference")).toBe("ORDER-249");
    expect(url.searchParams.get("signature:integrity")).toBe(
      "a0c1a8e6a7d0a7c9e7d7f6a42e7f0a6d4bbd9a6e4c9a8f2e0f2c4c6a4b4b8f4e",
    );
  });

  it("matches Wompi's published SHA-256 example", () => {
    const checkout = buildWompiWebCheckout(
      {
        intent: intent("24900.000000"),
        providerReference: "sk8-438k4-xmxm392-sn2m",
      },
      {
        publicKey: "pub_test_example",
        integritySecret:
          "prod_integrity_Z5mMke9x0k8gpErbDqwrJXMqsI6SFli6",
      },
    );

    const url = new URL(checkout.url);
    expect(url.searchParams.get("amount-in-cents")).toBe("2490000");
    expect(url.searchParams.get("signature:integrity")).toBe(
      "37c8407747e595535433ef8f6a811d853cd943046624a0ec04662b17bbf33bf5",
    );
  });

  it("rejects sub-cent precision instead of rounding", () => {
    expect(() =>
      buildWompiWebCheckout(
        {
          intent: intent("100.001000"),
          providerReference: "ORDER-100",
        },
        credentials,
      ),
    ).toThrow("precision below one COP cent");
  });

  it("never places the integrity secret in the checkout URL", () => {
    const checkout = buildWompiWebCheckout(
      {
        intent: intent("1000.000000"),
        providerReference: "ORDER-1000",
      },
      credentials,
    );

    expect(checkout.url).not.toContain(credentials.integritySecret);
    expect(checkout.url).toContain("signature%3Aintegrity=");
  });
});

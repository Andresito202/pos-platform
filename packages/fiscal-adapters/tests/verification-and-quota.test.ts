import { describe, expect, it } from "vitest";
import {
  EVIDENCE_SOURCES,
  VERIFICATION_LEVELS,
  evaluateQuotaSignal,
  isVerificationSupportedBySource,
  maxVerificationForSource,
  meetsVerification,
  quotaAllowsNewIssuance,
  quotaBlocksCommercialSale,
  type QuotaObservability,
  type QuotaSignal,
} from "../src/index.js";

describe("escalera de verificación", () => {
  it("está ordenada y NOT_EVALUATED es el suelo", () => {
    expect(VERIFICATION_LEVELS[0]).toBe("NOT_EVALUATED");
    expect(meetsVerification("SANDBOX_VERIFIED", "MOCK_TESTED")).toBe(true);
    expect(meetsVerification("MOCK_TESTED", "SANDBOX_VERIFIED")).toBe(false);
    expect(meetsVerification("CERTIFIED", "CERTIFIED")).toBe(true);
  });

  it("un fake determinista nunca sostiene más que MOCK_TESTED (`D-4`)", () => {
    expect(maxVerificationForSource("DETERMINISTIC_FAKE")).toBe("MOCK_TESTED");
    expect(isVerificationSupportedBySource("SANDBOX_VERIFIED", "DETERMINISTIC_FAKE")).toBe(false);
    expect(isVerificationSupportedBySource("MOCK_TESTED", "DETERMINISTIC_FAKE")).toBe(true);
  });

  it("cada fuente tiene un techo y ninguna lo excede", () => {
    for (const source of EVIDENCE_SOURCES) {
      const ceiling = maxVerificationForSource(source);
      expect(isVerificationSupportedBySource(ceiling, source)).toBe(true);
    }
  });

  it("sin evidencia no se sostiene ni MOCK_TESTED", () => {
    expect(isVerificationSupportedBySource("MOCK_TESTED", "NONE")).toBe(false);
  });
});

describe("saldo de bolsa como proyección observable (`D-5`)", () => {
  const modelled: QuotaObservability = {
    kind: "MODELLED",
    source: "LOCAL_PROJECTION",
    warnThresholdRemaining: 100,
  };
  const notEvaluated: QuotaObservability = {
    kind: "NOT_EVALUATED",
    reason: "sin endpoint de saldo verificado",
  };

  it("alerta antes del agotamiento, que es para lo que se modela", () => {
    expect(evaluateQuotaSignal(modelled, 5_000)).toEqual({ kind: "OK", remaining: 5_000 });
    expect(evaluateQuotaSignal(modelled, 80)).toEqual({
      kind: "APPROACHING_EXHAUSTION",
      remaining: 80,
    });
    expect(evaluateQuotaSignal(modelled, 0)).toEqual({ kind: "EXHAUSTED" });
  });

  it("sin forma verificada de consultar el saldo, la señal es UNKNOWN, no OK", () => {
    expect(evaluateQuotaSignal(notEvaluated, 5_000)).toEqual({ kind: "UNKNOWN" });
    expect(evaluateQuotaSignal(modelled, null)).toEqual({ kind: "UNKNOWN" });
  });

  it("un plan sin bolsa da UNLIMITED, que no es lo mismo que UNKNOWN", () => {
    // ALEGRA vende documentos ilimitados en plan de pago. Declararlo
    // `NOT_EVALUATED` sería falso: sí se evaluó, y no hay bolsa que agotar.
    const unlimited: QuotaObservability = {
      kind: "NOT_APPLICABLE",
      reason: "plan de pago con documentos ilimitados",
    };
    expect(evaluateQuotaSignal(unlimited, null)).toEqual({ kind: "UNLIMITED" });
    expect(evaluateQuotaSignal(unlimited, 3)).toEqual({ kind: "UNLIMITED" });
    // Y no impide emitir, que es lo que un `EXHAUSTED` sí haría.
    expect(quotaAllowsNewIssuance({ kind: "UNLIMITED" })).toBe(true);
  });

  it("el saldo fiscal NUNCA bloquea una venta comercial, ni agotado", () => {
    const signals: readonly QuotaSignal[] = [
      { kind: "OK", remaining: 10 },
      { kind: "APPROACHING_EXHAUSTION", remaining: 3 },
      { kind: "EXHAUSTED" },
      { kind: "UNLIMITED" },
      { kind: "UNKNOWN" },
    ];
    for (const signal of signals) {
      expect(quotaBlocksCommercialSale(signal)).toBe(false);
    }
  });

  it("pero el agotamiento sí detiene la emisión fiscal, que es otra decisión", () => {
    expect(quotaAllowsNewIssuance({ kind: "EXHAUSTED" })).toBe(false);
    expect(quotaAllowsNewIssuance({ kind: "APPROACHING_EXHAUSTION", remaining: 3 })).toBe(true);
    expect(quotaAllowsNewIssuance({ kind: "UNKNOWN" })).toBe(true);
  });
});

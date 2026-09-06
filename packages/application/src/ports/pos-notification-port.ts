import type { PaymentConfirmedNotificationRequested } from "@pos-platform/domain";

/**
 * "Sonido como capacidad de presentación del POS" (FASE 2-E): this port
 * only carries the CONTRACT to the POS — it never plays audio or renders
 * UI itself. Visual + sound are both consequences the POS-side consumer
 * derives from `notificationType` after a successful `notify()`, not two
 * separate calls this port makes — this keeps "misma notificación, sin
 * doble procesamiento" (the block's own requirement) structural rather
 * than something two callers could accidentally desynchronize.
 *
 * Delivery transport is deliberately unresolved (FASE 2-G): the existing
 * local IPC channel (`apps/pos-local-service/src/channel/*`) is a
 * same-machine, request/response protocol today (`runtime.handshake`,
 * `operation.confirm`, `operation.result.get` — no server-initiated push
 * message type observed), so it does not, by itself, resolve delivery of
 * an event that originates centrally/remotely. No WebSocket/SSE exists
 * anywhere in this repository (verified) and none is introduced here —
 * this port is the abstraction a future adapter (an extension of the
 * local channel, a new remote channel, or both) will implement.
 *
 * `notify()` returning `ALREADY_DELIVERED` (instead of silently
 * succeeding twice) is the FASE 2-F notification-dedup contract — keyed
 * by `PaymentConfirmedNotificationRequested.notificationId`, deliberately
 * independent of `Payment`/`PaymentAttempt` idempotency.
 */
export interface PosNotificationPort {
  notify(notification: PaymentConfirmedNotificationRequested): Promise<"DELIVERED" | "ALREADY_DELIVERED">;
}

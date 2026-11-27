import type { IncomingMessage, ServerResponse } from "node:http";
import {
  MERCHANT_PAYMENT_NOTICE_PATH,
  MerchantPaymentNoticeObservationSchema,
  UuidSchema,
  uuidV7,
  type MerchantPaymentNoticeObservation,
} from "@pos-platform/contracts";
import {
  PostgresMerchantPaymentNoticeProofVerifier,
  type Pool,
  type VerifiedDeviceProofBinding,
} from "@pos-platform/database-postgres";

const MAX_BODY_BYTES = 1_024;
const MAX_AGE_MS = 48 * 60 * 60 * 1_000;
const MAX_FUTURE_MS = 5 * 60 * 1_000;

async function storeMerchantPaymentNotice(
  pool: Pool,
  device: VerifiedDeviceProofBinding,
  notice: MerchantPaymentNoticeObservation,
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id',$1,true),set_config('app.company_id',$2,true)", [
      device.tenantId, device.companyId,
    ]);
    await client.query("SET LOCAL lock_timeout='3s'");
    await client.query("SET LOCAL statement_timeout='5s'");
    // Keep a renewed or revoked credential from authorizing a late write.
    const active = await client.query(`
      SELECT 1 FROM identity.device_credentials
      WHERE credential_id=$1 AND device_id=$2 AND installation_id=$3
        AND tenant_id=$4 AND company_id=$5 AND status='ACTIVE'
        AND expires_at > clock_timestamp()
      FOR SHARE
    `, [device.credentialId, device.deviceId, device.installationId, device.tenantId, device.companyId]);
    if (active.rowCount !== 1) {
      await client.query("ROLLBACK");
      return false;
    }

    // The DB trigger share-locks merchant consent and the active device.
    // A shared message can arrive from more than one consented bridge.
    await client.query(`
      INSERT INTO payments.merchant_payment_notification_inbox
        (id,tenant_id,company_id,source_installation_id,message_sha256,observed_at,reported_amount_cop)
      VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (tenant_id,company_id,message_sha256) DO NOTHING
    `, [
      uuidV7(), device.tenantId, device.companyId, device.installationId,
      notice.message_sha256, notice.observed_at, notice.reported_amount_cop,
    ]);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error instanceof Error && "code" in error && error.code === "P4101") return false;
    throw error;
  } finally {
    client.release();
  }
}

function reply(response: ServerResponse, status: number, code: string): true {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify({ code }));
  return true;
}

export function createMerchantPaymentNoticeHandler(
  pool: Pool,
  origin: string,
  readBody: (request: IncomingMessage, maxBytes: number) => Promise<string>,
  allowRate: (bucket: string) => boolean | Promise<boolean>,
  now: () => number = Date.now,
) {
  const host = new URL(origin).host;
  const proofs = new PostgresMerchantPaymentNoticeProofVerifier(pool);
  return async (request: IncomingMessage, response: ServerResponse): Promise<boolean> => {
    if (request.url !== MERCHANT_PAYMENT_NOTICE_PATH) return false;
    if (request.method !== "POST") return reply(response, 405, "METHOD_NOT_ALLOWED");
    if (request.headers.host !== host) return reply(response, 421, "CENTRAL_HOST_REJECTED");

    const authorization = request.headers.authorization;
    const requestId = UuidSchema.safeParse(request.headers["x-request-id"]);
    const correlationId = UuidSchema.safeParse(request.headers["x-correlation-id"]);
    if (!authorization || !requestId.success || !correlationId.success ||
        request.headers["content-type"]?.split(";")[0]?.trim() !== "application/json") {
      return reply(response, 400, "INVALID_MERCHANT_NOTICE");
    }

    try {
      if (!(await allowRate(`${request.socket.remoteAddress ?? "unknown"}:merchant-notice`))) {
        return reply(response, 429, "RATE_LIMITED");
      }
    } catch {
      return reply(response, 503, "MERCHANT_NOTICE_UNAVAILABLE");
    }
    let body;
    let payload: unknown;
    try {
      body = await readBody(request, MAX_BODY_BYTES);
      if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) return reply(response, 413, "MERCHANT_NOTICE_TOO_LARGE");
      payload = JSON.parse(body);
    } catch {
      return reply(response, 400, "INVALID_MERCHANT_NOTICE");
    }
    const notice = MerchantPaymentNoticeObservationSchema.safeParse(payload);
    if (!notice.success) return reply(response, 400, "INVALID_MERCHANT_NOTICE");
    const age = now() - Date.parse(notice.data.observed_at);
    if (age < -MAX_FUTURE_MS || age > MAX_AGE_MS) return reply(response, 400, "INVALID_MERCHANT_NOTICE");

    try {
      const device = await proofs.verifyIngestAndConsume({
        authorization, requestId: requestId.data, correlationId: correlationId.data, body,
      });
      if (!device || !(await storeMerchantPaymentNotice(pool, device, notice.data))) {
        return reply(response, 403, "MERCHANT_NOTICE_FORBIDDEN");
      }
      return reply(response, 202, "MERCHANT_NOTICE_UNVERIFIED");
    } catch {
      return reply(response, 503, "MERCHANT_NOTICE_UNAVAILABLE");
    }
  };
}

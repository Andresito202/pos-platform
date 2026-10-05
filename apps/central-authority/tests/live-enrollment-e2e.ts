import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { Pool } from "pg";
import { DeviceEnrollmentRequestSchema, DeviceEnrollmentResultSchema } from "@pos-platform/contracts";
import { createEnrollmentChallenge, activationSecretChecksum, canonicalDeviceTrustJson } from "@pos-platform/device-trust";

const databaseUrl = process.env.CENTRAL_DATABASE_URL ?? "";
const endpoint = process.env.D3_ENROLLMENT_URL ?? "";
const transportToken = process.env.D3_ENROLLMENT_TRANSPORT_TOKEN ?? "";
if (!databaseUrl || !endpoint || !transportToken) throw new Error("D3 live enrollment environment is incomplete");

function uuidV7(): string {
  const now = BigInt(Date.now());
  const random = randomBytes(10);
  const bytes = Buffer.alloc(16);
  for (let i = 0; i < 6; i += 1) bytes[i] = Number((now >> BigInt(40 - i * 8)) & 0xffn);
  bytes[6] = 0x70 | (random[0]! & 0x0f);
  bytes[7] = random[1]!;
  bytes[8] = 0x80 | (random[2]! & 0x3f);
  random.copy(bytes, 9, 3);
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const ids = {
  tenant: uuidV7(),
  company: uuidV7(),
  installation: uuidV7(),
  device: uuidV7(),
  activation: uuidV7(),
};
const deviceKeyId = `D3_CI_DEVICE_${ids.device.replaceAll("-", "").slice(0, 16).toUpperCase()}`;
const trustKeyId = `D3_CI_TRUST_${ids.device.replaceAll("-", "").slice(0, 16).toUpperCase()}`;
const activationSecret = `D3CI_${randomBytes(36).toString("base64url")}`;
const now = new Date();
const challengeIssued = now.toISOString();
const challengeExpires = new Date(now.getTime() + 60_000).toISOString();

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const challenge = createEnrollmentChallenge({
  tenant_id: ids.tenant,
  installation_id: ids.installation,
  device_id: ids.device,
  issued_at: challengeIssued,
  expires_at: challengeExpires,
});
const proof = {
  challenge_id: challenge.challenge_id,
  device_key_id: deviceKeyId,
  signature: sign(null, Buffer.from(canonicalDeviceTrustJson(challenge)), privateKey).toString("base64url"),
};
const request = {
  activation_id: ids.activation,
  activation_secret: activationSecret,
  tenant_id: ids.tenant,
  company_id: ids.company,
  installation_id: ids.installation,
  device_id: ids.device,
  device_key_id: deviceKeyId,
  device_public_key_pem: publicKeyPem,
  challenge,
  proof,
  requested_at: challengeIssued,
  version: 1,
};

const validatedRequest = DeviceEnrollmentRequestSchema.parse(request);

const pool = new Pool({ connectionString: databaseUrl, max: 2 });
try {
  await pool.query(
    `INSERT INTO identity.device_registry
      (device_id, installation_id, tenant_id, company_id, device_key_id, device_public_key, device_public_key_algorithm, status, trust_key_id, trust_key_purpose, created_at, updated_at, version)
     VALUES ($1,$2,$3,$4,$5,$6,'Ed25519','PENDING',$7,'DEVICE_TRUST',clock_timestamp(),clock_timestamp(),1)`,
    [ids.device, ids.installation, ids.tenant, ids.company, deviceKeyId, Buffer.from(publicKeyPem), trustKeyId],
  );
  await pool.query(
    `INSERT INTO identity.device_enrollment_activations
      (activation_id, tenant_id, company_id, installation_id, device_id, activation_checksum, status, issued_at, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,'ISSUED',clock_timestamp(),clock_timestamp() + interval '10 minutes')`,
    [ids.activation, ids.tenant, ids.company, ids.installation, ids.device, activationSecretChecksum(activationSecret)],
  );

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${transportToken}`,
      "content-type": "application/json",
      "x-request-id": `d3-live-${ids.activation}`,
      "x-correlation-id": `d3-live-${ids.device}`,
    },
    body: JSON.stringify(validatedRequest),
  });
  const body = await response.text();
  if (response.status !== 200) throw new Error(`live enrollment failed: ${response.status} ${body}`);
  const parsed = JSON.parse(body) as { status?: string; result_code?: string; result?: unknown };
  if (parsed.status !== "SUCCEEDED" || parsed.result_code !== "ENROLLED" || parsed.result === undefined) {
    throw new Error(`live enrollment returned invalid envelope: ${body}`);
  }
  const enrollmentResult = DeviceEnrollmentResultSchema.parse(parsed.result);
  if (enrollmentResult.status !== "ENROLLED" || enrollmentResult.credential_id === null || enrollmentResult.credential === null) {
    throw new Error(`live enrollment returned incomplete credential: ${body}`);
  }

  const state = await pool.query<{ activation_status: string; device_status: string; credential_count: string }>(
    `SELECT a.status activation_status, d.status device_status,
            (SELECT count(*)::text FROM identity.device_credentials c WHERE c.device_id=d.device_id) credential_count
       FROM identity.device_enrollment_activations a
       JOIN identity.device_registry d ON d.device_id=a.device_id
      WHERE a.activation_id=$1`, [ids.activation],
  );
  const row = state.rows[0];
  if (!row || row.activation_status !== "CONSUMED" || row.device_status !== "ACTIVE" || row.credential_count !== "1") {
    throw new Error(`live enrollment persistence invariant failed: ${JSON.stringify(row)}`);
  }

  const replay = await fetch(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${transportToken}`, "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  const replayBody = await replay.text();
  if (replay.status !== 409) throw new Error(`activation replay was not rejected as conflict: ${replay.status} ${replayBody}`);
  if (/password|private.?key|ci-transport-token/i.test(replayBody)) throw new Error("replay response leaked sensitive material");

  process.stdout.write(JSON.stringify({
    D3_LIVE_ENROLLMENT: "PASS",
    status: response.status,
    activation: row.activation_status,
    device: row.device_status,
    credentials: row.credential_count,
    replay_status: replay.status,
  }) + "\n");
} finally {
  await pool.end();
}

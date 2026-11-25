import { createHash, createPrivateKey, randomUUID } from "node:crypto";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { parseArgs } from "node:util";
import {
  createCentralDeviceHttpRequestSchema,
  createSyncBatchRequestSchema,
  SyncOperationSchema,
  UuidSchema,
} from "@pos-platform/contracts";
import { createDeviceRequestAuthorization } from "@pos-platform/device-trust";
import { canonicalJson } from "@pos-platform/local-channel";

const salesPerRegister = 100;
const maxOperationsPerBatch = 100;
const requestSchema = createCentralDeviceHttpRequestSchema(createSyncBatchRequestSchema(maxOperationsPerBatch), {
  maxBodyBytes: 4 * 1024 * 1024,
  requireIdempotency: false,
});

function file(path: unknown, limit: number, secret = false): Buffer {
  if (typeof path !== "string" || !isAbsolute(path)) throw new Error("ABSOLUTE_FILE_REQUIRED");
  const info = lstatSync(path);
  if (!info.isFile() || info.size > limit || (secret && (info.mode & 0o077) !== 0)) {
    throw new Error("STAGING_FILE_NOT_ALLOWED");
  }
  return readFileSync(path);
}

const args = parseArgs({ options: { manifest: { type: "string" }, output: { type: "string" } } }).values;
if (process.env.K6_ENVIRONMENT !== "authorized-staging" || !args.output || !isAbsolute(args.output)) {
  throw new Error("K6_AUTHORIZED_STAGING_AND_ABSOLUTE_OUTPUT_REQUIRED");
}
const manifest: unknown = JSON.parse(file(args.manifest, 1024 * 1024).toString("utf8"));
if (manifest === null || typeof manifest !== "object" || !("environment" in manifest) ||
    manifest.environment !== "staging" || !("registers" in manifest) ||
    !Array.isArray(manifest.registers) || manifest.registers.length !== 30) {
  throw new Error("STAGING_MANIFEST_REQUIRES_30_REGISTERS");
}

const ids = new Set<string>();
const devices = new Set<string>();
const installations = new Set<string>();
const credentials = new Set<string>();
const operationsSeen = new Set<string>();
const companies = new Map<string, { tenantId: string; count: number }>();
let totalOperations = 0;
const registers = manifest.registers.map((raw: unknown) => {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("INVALID_STAGING_REGISTER");
  const entry = raw as Record<string, unknown>;
  const registerId = UuidSchema.parse(entry.registerId);
  const tenantId = UuidSchema.parse(entry.tenantId);
  const companyId = UuidSchema.parse(entry.companyId);
  const branchId = UuidSchema.parse(entry.branchId);
  const deviceId = UuidSchema.parse(entry.deviceId);
  const installationId = UuidSchema.parse(entry.installationId);
  const credentialId = UuidSchema.parse(entry.credentialId);
  if (ids.has(registerId) || devices.has(deviceId) || installations.has(installationId) || credentials.has(credentialId)) {
    throw new Error("STAGING_REQUIRES_DISTINCT_REGISTER_DEVICE_INSTALLATION_AND_CREDENTIAL");
  }
  ids.add(registerId);
  devices.add(deviceId);
  installations.add(installationId);
  credentials.add(credentialId);
  const company = companies.get(companyId) ?? { tenantId, count: 0 };
  if (company.tenantId !== tenantId) throw new Error("STAGING_COMPANY_TENANT_MISMATCH");
  company.count++;
  companies.set(companyId, company);

  const operations = SyncOperationSchema.array().parse(JSON.parse(file(entry.outboxFile, 20 * 1024 * 1024).toString("utf8")));
  if (operations.filter((op) => op.operation_type === "SALE_CREATED").length !== salesPerRegister ||
      operations.length < 2 || operations.length > maxOperationsPerBatch * 2) {
    throw new Error("STAGING_REQUIRES_100_SALES_AND_AT_MOST_200_OPERATIONS_PER_REGISTER");
  }
  for (const operation of operations) {
    if (operationsSeen.has(operation.operation_id)) throw new Error("STAGING_DUPLICATE_OPERATION_ID");
    operationsSeen.add(operation.operation_id);
    const checksum = createHash("sha256").update(canonicalJson(operation.payload)).digest("hex");
    if (checksum !== operation.payload_checksum) {
      throw new Error(`STAGING_OUTBOX_CHECKSUM_MISMATCH operation=${operation.operation_id}`);
    }
  }
  totalOperations += operations.length;
  const key = createPrivateKey(file(entry.signingKeyFile, 32768, true));
  if (key.asymmetricKeyType !== "ed25519") throw new Error("STAGING_ED25519_REQUIRED");
  return { companyId, tenantId, branchId, deviceId, installationId, credentialId, operations, key };
});
if (companies.size !== 10 || [...companies.values()].some((entry) => entry.count !== 3) || totalOperations !== 5000) {
  throw new Error("STAGING_REQUIRES_10_COMPANIES_3_REGISTERS_EACH_AND_5000_OPERATIONS");
}

const signedAt = new Date();
const result = registers.map((entry: typeof registers[number]) => {
  const halfway = Math.ceil(entry.operations.length / 2);
  const batches = [entry.operations.slice(0, halfway), entry.operations.slice(halfway)].map((operations) => {
    const requestId = randomUUID();
    const correlationId = randomUUID();
    const bodyObject = {
      protocol_version: "1.0.0",
      message_type: "sync.batch.push",
      request_id: requestId,
      correlation_id: correlationId,
      tenant_id: entry.tenantId,
      device_id: entry.deviceId,
      payload_schema_version: "1.0.0",
      payload: {
        batch_id: randomUUID(),
        tenant_id: entry.tenantId,
        company_id: entry.companyId,
        branch_id: entry.branchId,
        device_id: entry.deviceId,
        installation_id: entry.installationId,
        checkpoint_local_sequence: operations[0]!.local_sequence - 1,
        operations,
      },
    };
    const body = JSON.stringify(bodyObject);
    const headers = {
      authorization: createDeviceRequestAuthorization({
        method: "POST", path: "/v1/sync/batches", requestId, correlationId, credentialId: entry.credentialId, body,
      }, entry.key, signedAt),
      "content-type": "application/json",
      accept: "application/json",
      "x-pos-api-version": "1.0.0",
      "x-request-id": requestId,
      "x-correlation-id": correlationId,
      "x-pos-device-id": entry.deviceId,
      "x-pos-installation-id": entry.installationId,
    };
    requestSchema.parse({ contract_headers: headers, received_body_bytes: Buffer.byteLength(body), body: bodyObject });
    return { headers, body };
  });
  return { deviceId: entry.deviceId, companyId: entry.companyId, batches };
});
writeFileSync(args.output, JSON.stringify(result), { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ companies: companies.size, registers: devices.size, sales: devices.size * salesPerRegister,
  operations: totalOperations, batches: devices.size * 2, signedAt: signedAt.toISOString() }));

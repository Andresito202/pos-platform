import http from "k6/http";
import { check } from "k6";
import exec from "k6/execution";
import { Counter } from "k6/metrics";

const profile = JSON.parse(open(__ENV.PROFILE || "./profiles/commercial-initial.json"));
const fixtures = JSON.parse(open(__ENV.SYNC_FIXTURE_FILE || ""));
const base = (__ENV.SYNC_BASE_URL || "").replace(/\/+$/, "");
if (__ENV.K6_ENVIRONMENT !== "authorized-staging" || !base.startsWith("https://")) {
  throw new Error("HTTPS staging and K6_ENVIRONMENT=authorized-staging are required");
}
const { companies, cash_registers_total: registers } = profile.tenancy;
const batchesPerDevice = fixtures[0]?.batches.length;
const operations = new Set();
const deviceIds = new Set();
const companyIds = new Set();
let sales = 0;
for (const device of fixtures) {
  deviceIds.add(device.deviceId);
  companyIds.add(device.companyId);
  if (device.batches.length !== batchesPerDevice) throw new Error("equal batch counts required per device");
  for (const fixture of device.batches) {
    const batch = JSON.parse(fixture.body).payload;
    if (batch.device_id !== device.deviceId || batch.company_id !== device.companyId ||
        typeof fixture.headers.authorization !== "string") throw new Error("device proof fixture mismatch");
    for (const operation of batch.operations) {
      if (operations.has(operation.operation_id)) throw new Error("operations must be unique per drill");
      operations.add(operation.operation_id);
      if (operation.operation_type === "SALE_CREATED") sales += 1;
    }
  }
}
if (fixtures.length !== registers || deviceIds.size !== registers || companyIds.size !== companies ||
    !batchesPerDevice || operations.size !== profile.throughput.sync_burst_outbox_events ||
    sales !== profile.throughput.sales_per_day) {
  throw new Error("fixture corpus does not match the commercial profile");
}

const committed = new Counter("sync_unique_operations_acknowledged");
const saleEvents = new Counter("sync_sale_events_acknowledged");
const targets = profile.thresholds_targets;
export const options = {
  scenarios: {
    authenticated_sync: {
      executor: "per-vu-iterations",
      vus: profile.throughput.sync_burst_concurrency,
      iterations: batchesPerDevice,
      maxDuration: "90s",
    },
  },
  thresholds: {
    checks: ["rate==1"],
    http_req_failed: [targets.http_req_failed],
    http_req_duration: [
      `p(95)<${targets.http_req_duration_p95_ms}`,
      `p(99)<${targets.http_req_duration_p99_ms}`,
    ],
    sync_unique_operations_acknowledged: [`count==${operations.size}`],
    sync_sale_events_acknowledged: [`count==${sales}`],
  },
};

export default function () {
  const f = fixtures[exec.vu.idInTest - 1].batches[exec.vu.iterationInScenario];
  const expected = JSON.parse(f.body).payload;
  const response = http.post(`${base}/v1/sync/batches`, f.body, {
    headers: f.headers,
    redirects: 0,
    tags: { name: "POST /v1/sync/batches" },
  });
  const result = response.status === 200 ? response.json("result") : null;
  const expectedIds = new Set(expected.operations.map((op) => op.operation_id));
  if (check(response, {
    "all operations durably accepted": () => result?.batch_id === expected.batch_id &&
      result.device_id === expected.device_id && result.tenant_id === expected.tenant_id &&
      Array.isArray(result.results) && result.results.length === expectedIds.size &&
      result.results.every((op) => expectedIds.delete(op.operation_id) &&
        op.server_status === "SERVER_ACCEPTED" && op.committed_at_server !== null),
  })) {
    committed.add(expected.operations.length);
    saleEvents.add(expected.operations.filter((op) => op.operation_type === "SALE_CREATED").length);
  }
}

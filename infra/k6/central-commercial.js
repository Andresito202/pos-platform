/**
 * k6 load script — Central Authority commercial capacity profile.
 *
 * Usage (operator machine with k6 installed):
 *   k6 run -e BASE_URL=https://central.example:9443 \
 *          -e TRANSPORT_TOKEN=*** \
 *          -e PROFILE=infra/k6/profiles/commercial-initial.json \
 *          infra/k6/central-commercial.js
 *
 * Does not print fabricated results. Thresholds are targets for the initial
 * 10 companies / 30 registers / 3000 sales/day profile.
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const denied = new Rate("central_rate_limited");
const latency = new Trend("central_request_ms");

const BASE = __ENV.BASE_URL || "https://127.0.0.1:9443";
const TOKEN = __ENV.TRANSPORT_TOKEN || "";

/** ~3000 sales/day ⇒ ~0.035 rps average; peak VU set models sync + auth bursts. */
export const options = {
  scenarios: {
    steady_auth_boundary: {
      executor: "constant-arrival-rate",
      rate: 2,
      timeUnit: "1s",
      duration: "2m",
      preAllocatedVUs: 20,
      maxVUs: 50,
      exec: "sessionTrust",
    },
    rate_limit_probe: {
      executor: "constant-arrival-rate",
      rate: 40,
      timeUnit: "1s",
      duration: "30s",
      startTime: "2m",
      preAllocatedVUs: 40,
      maxVUs: 80,
      exec: "sessionTrust",
    },
    sync_burst: {
      executor: "ramping-vus",
      startTime: "2m30s",
      stages: [
        { duration: "10s", target: 30 },
        { duration: "30s", target: 30 },
        { duration: "10s", target: 0 },
      ],
      exec: "health",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<500", "p(99)<1500"],
  },
  insecureSkipTLSVerify: true,
};

function headers() {
  const h = { Accept: "application/json" };
  if (TOKEN) h.Authorization = `Bearer ${TOKEN}`;
  return h;
}

export function health() {
  const res = http.get(`${BASE}/health`, { headers: headers() });
  latency.add(res.timings.duration);
  check(res, { "health 200": (r) => r.status === 200 });
  sleep(0.05);
}

export function sessionTrust() {
  const res = http.get(`${BASE}/v1/session-trust`, { headers: headers() });
  latency.add(res.timings.duration);
  const limited = res.status === 429;
  denied.add(limited);
  check(res, {
    "session-trust authorized or rate-limited": (r) =>
      r.status === 200 || r.status === 401 || r.status === 429,
  });
  sleep(0.02);
}

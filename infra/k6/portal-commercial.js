/**
 * k6 load script — commercial portal (camacho-pos-comercial).
 *
 * Usage:
 *   k6 run -e PORTAL_BASE_URL=https://portal.example \
 *          infra/k6/portal-commercial.js
 *
 * Targets the initial commercial profile. No fabricated pass/fail.
 */
import http from "k6/http";
import { check, sleep } from "k6";

const BASE = __ENV.PORTAL_BASE_URL || "http://127.0.0.1:3000";

export const options = {
  scenarios: {
    portal_steady: {
      executor: "constant-arrival-rate",
      rate: 5,
      timeUnit: "1s",
      duration: "2m",
      preAllocatedVUs: 20,
      maxVUs: 40,
    },
    portal_login_burst: {
      executor: "constant-arrival-rate",
      rate: 15,
      timeUnit: "1s",
      duration: "20s",
      startTime: "2m",
      preAllocatedVUs: 30,
      maxVUs: 60,
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.02"],
    http_req_duration: ["p(95)<800", "p(99)<2000"],
  },
  insecureSkipTLSVerify: true,
};

export default function () {
  const home = http.get(`${BASE}/`);
  check(home, {
    "portal reachable": (r) => r.status === 200 || r.status === 302 || r.status === 401,
  });
  sleep(0.1);
}

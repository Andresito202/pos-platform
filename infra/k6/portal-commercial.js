import http from "k6/http";
import { check } from "k6";

const base = (__ENV.PORTAL_BASE_URL || "").replace(/\/+$/, "");
const token = __ENV.PORTAL_GLOBAL_BEARER;
if (__ENV.K6_ENVIRONMENT !== "authorized-staging" || !base.startsWith("https://") || !token) {
  throw new Error("HTTPS staging and a real portal GLOBAL bearer are required");
}

export const options = {
  scenarios: {
    portal_catalog: {
      executor: "constant-arrival-rate",
      rate: 5,
      timeUnit: "1s",
      duration: "2m",
      preAllocatedVUs: 20,
      maxVUs: 40,
    },
  },
  thresholds: {
    checks: ["rate==1"],
    http_req_failed: ["rate<0.02"],
    http_req_duration: ["p(95)<800", "p(99)<2000"],
  },
};

export default function () {
  const result = http.get(`${base}/v1/admin/catalog/plans`, {
    headers: { Authorization: `Bearer ${token}` },
    redirects: 0,
  });
  check(result, { "GLOBAL plans returned": (r) => r.status === 200 && Array.isArray(r.json()) });
}

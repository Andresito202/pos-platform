import http from "k6/http";
import { check, fail } from "k6";

const replicas = [__ENV.AUTHORITY_REPLICA_A, __ENV.AUTHORITY_REPLICA_B]
  .map((url) => (url || "").replace(/\/+$/, ""));
const token = __ENV.TRANSPORT_TOKEN;
if (__ENV.K6_ENVIRONMENT !== "authorized-staging" || !token ||
    replicas.some((url) => !url.startsWith("https://")) || replicas[0] === replicas[1]) {
  throw new Error("two HTTPS staging authority replicas and a session-trust bearer are required");
}

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: { checks: ["rate==1"], http_req_failed: ["rate==0"] },
};

export default function () {
  const started = Date.now();
  const params = {
    headers: { Authorization: `Bearer ${token}` },
    redirects: 0,
    responseCallback: http.expectedStatuses(200, 429),
    tags: { name: "GET /v1/session-trust" },
  };
  for (let index = 0; index < 30; index++) {
    const res = http.get(`${replicas[index % 2]}/v1/session-trust`, params);
    if (!check(res, { "authenticated budget still available": (r) => r.status === 200 })) {
      fail("isolated baseline failed");
    }
  }
  if (Date.now() - started >= 50000) fail("requests did not fit within the shared window");
  for (const replica of replicas) {
    const res = http.get(`${replica}/v1/session-trust`, params);
    check(res, {
      "both replicas enforce exhausted shared budget": (r) => r.status === 429 &&
        r.json("result_code") === "SESSION_TRUST_RATE_LIMITED",
    });
  }
}

# k6 commercial capacity scripts

Profile: `profiles/commercial-initial.json` — **10 companies, 30 cash registers, 3 000 sales/day**, sync bursts.

| Script | Surface |
|---|---|
| `central-commercial.js` | Central health, session-trust, rate-limit probe, sync-burst VUs |
| `portal-commercial.js` | Portal reachability / auth boundary under load |

## Rules

- Requires a local `k6` binary (`k6` is **not** installed in CI by default).
- Do **not** claim PASS/FAIL without a real run against an authorized environment.
- Do **not** commit fabricated `summary.json` metrics.
- Secrets (`TRANSPORT_TOKEN`) via env only — never in the repo.

## Example

```bash
k6 run -e BASE_URL=https://127.0.0.1:9443 -e TRANSPORT_TOKEN="$TOKEN" infra/k6/central-commercial.js
k6 run -e PORTAL_BASE_URL=https://127.0.0.1:3000 infra/k6/portal-commercial.js
```

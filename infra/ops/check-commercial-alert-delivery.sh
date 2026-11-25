#!/usr/bin/env bash
# Real Prometheus evaluation and Alertmanager delivery on an internal test network.
set -euo pipefail
work="$(mktemp -d)"
chmod 0755 "$work"
name="pos-alert-check-$$"
prom_image=prom/prometheus:v3.5.0
alert_image=prom/alertmanager:v0.28.1
fixture_image=python:3.12-alpine
cleanup() {
  local result=$?
  if (( result != 0 )); then
    for service in prometheus alertmanager fixture; do docker logs "$name-$service" >&2 || true; done
  fi
  docker rm -f "$name-prometheus" "$name-alertmanager" "$name-fixture" >/dev/null 2>&1 || true
  docker network rm "$name" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cp infra/ops/commercial-alerts.prometheus.yml "$work/rules.yml"
cat > "$work/prometheus.yml" <<'YAML'
global:
  scrape_interval: 1s
  evaluation_interval: 1s
rule_files: [/etc/pos-test/rules.yml]
alerting:
  alertmanagers:
    - static_configs:
        - targets: ['alertmanager:9093']
scrape_configs:
  - job_name: 'commercial-signals-fixture'
    static_configs:
      - targets: ['fixture:8080']
YAML
cat > "$work/alertmanager.yml" <<'YAML'
route:
  receiver: 'test-webhook'
  group_by: ['alertname', 'kind']
  group_wait: 0s
receivers:
  - name: 'test-webhook'
    webhook_configs:
      - url: 'http://fixture:8080/alerts'
YAML
cat > "$work/fixture.py" <<'PY'
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

KINDS = ("fraud.privilege_abuse", "license.capacity_denied", "payment.webhook_rejected", "sync.conflict")
class Fixture(BaseHTTPRequestHandler):
    def do_GET(self):
        count = int(Path("/tmp/raise-signals").exists())
        samples = "".join(f'pos_security_signal_total{{kind="{kind}"}} {count}\n' for kind in KINDS)
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; version=0.0.4")
        self.end_headers()
        self.wfile.write(("# TYPE pos_security_signal_total counter\n" + samples).encode())

    def do_POST(self):
        event = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        with Path("/tmp/received.jsonl").open("a") as evidence:
            evidence.write(json.dumps(event) + "\n")
        self.send_response(200)
        self.end_headers()

HTTPServer(("0.0.0.0", 8080), Fixture).serve_forever()
PY

docker run --rm --network none -v "$work:/etc/pos-test:ro" --entrypoint /bin/promtool "$prom_image" \
  check rules /etc/pos-test/rules.yml
docker network create --internal "$name" >/dev/null
docker run -d --network "$name" --network-alias fixture --name "$name-fixture" \
  -v "$work:/etc/pos-test:ro" "$fixture_image" python /etc/pos-test/fixture.py >/dev/null
docker run -d --network "$name" --network-alias alertmanager --name "$name-alertmanager" \
  -v "$work:/etc/pos-test:ro" "$alert_image" --config.file=/etc/pos-test/alertmanager.yml >/dev/null
docker run -d --network "$name" --network-alias prometheus --name "$name-prometheus" \
  -v "$work:/etc/pos-test:ro" "$prom_image" --config.file=/etc/pos-test/prometheus.yml >/dev/null

for attempt in {1..40}; do
  if docker exec "$name-fixture" python -c 'import json,urllib.request; r=json.load(urllib.request.urlopen("http://prometheus:9090/api/v1/query?query=pos_security_signal_total", timeout=2)); assert len(r["data"]["result"])==4' 2>/dev/null; then
    break
  fi
  sleep 1
done
docker exec "$name-fixture" python -c 'import json,urllib.request; r=json.load(urllib.request.urlopen("http://prometheus:9090/api/v1/query?query=pos_security_signal_total", timeout=2)); assert len(r["data"]["result"])==4 and all(x["value"][1]=="0" for x in r["data"]["result"])'
docker exec "$name-fixture" touch /tmp/raise-signals
verify='import json; from pathlib import Path; events=[json.loads(line) for line in Path("/tmp/received.jsonl").read_text().splitlines()]; kinds={a["labels"]["kind"] for e in events for a in e["alerts"] if a["status"]=="firing" and a["labels"]["alertname"]=="CamachoCommercialSecuritySignal" and a["labels"]["severity"]=="warning"}; assert kinds=={"fraud.privilege_abuse","license.capacity_denied","payment.webhook_rejected","sync.conflict"}; print("ALERTMANAGER_WEBHOOK_OK", ", ".join(sorted(kinds)))'
for attempt in {1..45}; do
  if docker exec "$name-fixture" python -c "$verify" 2>/dev/null; then exit 0; fi
  sleep 1
done
docker exec "$name-fixture" python -c "$verify"

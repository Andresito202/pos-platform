#!/usr/bin/env bash
set -euo pipefail
runner="$(cd "$(dirname "$0")/.." && pwd)/gradle-with-network-retry.sh"
bin="$(mktemp -d)"
trap 'rm -rf "$bin"' EXIT
export PATH="$bin:$PATH"
export GRADLE_TEST_ATTEMPTS="$bin/attempts"

cat > "$bin/gradle" <<'GRADLE'
#!/usr/bin/env bash
set -eu
[[ " $* " == *' --info '* ]]
printf '%s\n' run >> "$GRADLE_TEST_ATTEMPTS"
if [[ "$GRADLE_TEST_SCENARIO" == succeeds && "$(wc -l < "$GRADLE_TEST_ATTEMPTS")" -gt 1 ]]; then
  exit 0
fi
if [[ "$GRADLE_TEST_SCENARIO" == ordinary ]]; then
  printf '%s\n' 'Plugin was not found in the configured repositories'
  exit 17
fi
printf '%s\n' 'Failed to get resource: GET. [HTTP HTTP/1.1 429 Too Many Requests: https://repo.maven.apache.org/maven2/example]'
if [[ "$GRADLE_TEST_SCENARIO" == compile ]]; then
  printf '%s\n' 'e: Source compilation error'
fi
exit 17
GRADLE
cat > "$bin/sleep" <<'SLEEP'
#!/usr/bin/env bash
exit 0
SLEEP
chmod +x "$bin/gradle" "$bin/sleep"

for scenario in succeeds throttled ordinary compile; do
  : > "$GRADLE_TEST_ATTEMPTS"
  status=0
  GRADLE_TEST_SCENARIO="$scenario" bash "$runner" commercialIdentityTest > "$bin/log" || status=$?
  case "$scenario" in
    succeeds) [[ "$status" == 0 && "$(wc -l < "$GRADLE_TEST_ATTEMPTS")" == 2 ]] ;;
    throttled) [[ "$status" == 17 && "$(wc -l < "$GRADLE_TEST_ATTEMPTS")" == 3 ]] ;;
    ordinary|compile) [[ "$status" == 17 && "$(wc -l < "$GRADLE_TEST_ATTEMPTS")" == 1 ]] ;;
  esac
done
printf '%s\n' 'Android Gradle runner: 4 scenarios passed'

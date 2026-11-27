#!/usr/bin/env bash
# Retry only a confirmed dependency-service HTTP 429, never compiler/test failures.
set -euo pipefail
log="$(mktemp)"
trap 'rm -f "$log"' EXIT
for attempt in 1 2 3; do
  set +e
  gradle -p apps/pos-android --no-daemon "$@" 2>&1 | tee "$log"
  statuses=("${PIPESTATUS[@]}")
  set -e
  status="${statuses[0]}"
  if (( statuses[1] != 0 )); then exit "${statuses[1]}"; fi
  if (( status == 0 )); then exit 0; fi
  if (( attempt == 3 )) || ! grep -Eqi '(Received status code 429|HTTP (error )?429|429 Too Many Requests)' "$log" || ! grep -Eq 'Could not (resolve|get resource|GET|HEAD|download)' "$log" || grep -Eq '(^e: |error: cannot find symbol|There were failing tests|> Task :[^ ]*[Tt]est FAILED|Compilation error)' "$log"; then
    exit "$status"
  fi
  delay=$((attempt * 30))
  printf 'Dependency service returned HTTP 429; retry %s in %s seconds\n' "$((attempt+1))" "$delay"
  sleep "$delay"
done

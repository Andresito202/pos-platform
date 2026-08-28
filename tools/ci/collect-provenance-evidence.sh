#!/usr/bin/env bash
set -euo pipefail

for variable in GH_TOKEN GITHUB_API_URL GITHUB_REPOSITORY GITHUB_RUN_ID GITHUB_RUN_ATTEMPT GITHUB_EVENT_NAME REVIEWED_SHA; do
  if [ -z "${!variable:-}" ]; then
    echo "::error::Missing required environment variable: ${variable}"
    exit 1
  fi
done

if [[ ! "$REVIEWED_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "::error::REVIEWED_SHA must be an exact lowercase Git SHA."
  exit 1
fi

api="${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}"
root="artifacts/ci/provenance-input"
index_parts="artifacts/ci/provenance-source-index.parts.jsonl"
index_path="artifacts/ci/provenance-source-index.json"
rm -rf "$root" "$index_parts" "$index_path"
mkdir -p "$root"
: > "$index_parts"

api_get() {
  curl --fail --silent --show-error \
    -H "Authorization: Bearer ${GH_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "$1"
}

current_artifacts="$(api_get "${api}/actions/runs/${GITHUB_RUN_ID}/artifacts?per_page=100")"

select_artifact() {
  local document="$1"
  local name="$2"
  printf '%s' "$document" | jq -ce --arg name "$name" '
    [.artifacts[] | select(.name == $name and .expired == false)]
    | if length == 1 then .[0] else error("expected exactly one non-expired artifact named " + $name) end
  '
}

validate_archive_entries() {
  local archive="$1"
  local invalid
  invalid="$(unzip -Z1 "$archive" | awk '
    /^\// { print; next }
    /(^|\/)\.\.($|\/)/ { print; next }
    /^[A-Za-z]:[\\\/]/ { print; next }
  ')"
  if [ -n "$invalid" ]; then
    echo "::error::Artifact archive contains an unsafe path."
    exit 1
  fi
}

download_artifact() {
  local role="$1"
  local workflow_run_id="$2"
  local artifact_json="$3"
  local artifact_id artifact_name artifact_digest directory archive
  artifact_id="$(printf '%s' "$artifact_json" | jq -r '.id')"
  artifact_name="$(printf '%s' "$artifact_json" | jq -r '.name')"
  artifact_digest="$(printf '%s' "$artifact_json" | jq -r '.digest')"
  if [[ ! "$artifact_id" =~ ^[0-9]+$ ]] || [[ ! "$artifact_digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    echo "::error::Artifact metadata is incomplete for role ${role}."
    exit 1
  fi
  directory="${root}/${role}"
  archive="${root}/${role}.zip"
  mkdir -p "$directory"
  curl --fail --silent --show-error --location \
    -H "Authorization: Bearer ${GH_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "${api}/actions/artifacts/${artifact_id}/zip" \
    -o "$archive"
  validate_archive_entries "$archive"
  unzip -q "$archive" -d "$directory"
  rm -f "$archive"
  if ! find "$directory" -type f -print -quit | grep -q .; then
    echo "::error::Downloaded artifact ${artifact_name} is empty."
    exit 1
  fi
  jq -cn \
    --arg role "$role" \
    --arg name "$artifact_name" \
    --argjson artifactId "$artifact_id" \
    --arg githubArtifactDigest "$artifact_digest" \
    --argjson workflowRunId "$workflow_run_id" \
    --arg directory "$directory" \
    '{role:$role,name:$name,artifactId:$artifactId,githubArtifactDigest:$githubArtifactDigest,workflowRunId:$workflowRunId,directory:$directory}' \
    >> "$index_parts"
}

for spec in \
  "target:target-exact-head-${REVIEWED_SHA}" \
  "inventory:target-dependency-inventory-${REVIEWED_SHA}" \
  "vulnerability:dependency-vulnerability-audit-${REVIEWED_SHA}" \
  "sbom:cyclonedx-sbom-${REVIEWED_SHA}" \
  "license:license-compatibility-${REVIEWED_SHA}"; do
  role="${spec%%:*}"
  name="${spec#*:}"
  artifact="$(select_artifact "$current_artifacts" "$name")"
  download_artifact "$role" "$GITHUB_RUN_ID" "$artifact"
done

codeql_run=""
for attempt in $(seq 1 40); do
  runs="$(api_get "${api}/actions/workflows/codeql-sast.yml/runs?per_page=100")"
  codeql_run="$(printf '%s' "$runs" | jq -c --arg sha "$REVIEWED_SHA" --arg event "$GITHUB_EVENT_NAME" '
    [.workflow_runs[]
      | select(.head_sha == $sha)
      | select(($event == "workflow_dispatch") or (.event == $event))]
    | sort_by(.run_number)
    | if length == 0 then empty else .[-1] end
  ')"
  if [ -n "$codeql_run" ]; then
    status="$(printf '%s' "$codeql_run" | jq -r '.status')"
    conclusion="$(printf '%s' "$codeql_run" | jq -r '.conclusion // ""')"
    if [ "$status" = "completed" ]; then
      if [ "$conclusion" != "success" ]; then
        echo "::error::Latest exact-head CodeQL run completed with conclusion=${conclusion}."
        exit 1
      fi
      break
    fi
  fi
  if [ "$attempt" -eq 40 ]; then
    echo "::error::Exact-head CodeQL SUCCESS was not available within the provenance wait window."
    exit 1
  fi
  sleep 15
done

codeql_run_id="$(printf '%s' "$codeql_run" | jq -r '.id')"
codeql_artifacts="$(api_get "${api}/actions/runs/${codeql_run_id}/artifacts?per_page=100")"
codeql_artifact="$(select_artifact "$codeql_artifacts" "codeql-sarif-${REVIEWED_SHA}")"
download_artifact "codeql" "$codeql_run_id" "$codeql_artifact"

jq -s \
  --arg reviewedSha "$REVIEWED_SHA" \
  --argjson targetRunId "$GITHUB_RUN_ID" \
  --argjson targetRunAttempt "$GITHUB_RUN_ATTEMPT" \
  --argjson codeqlRunId "$codeql_run_id" \
  '{schema:"pos-platform-provenance-source-index/v1",reviewedSha:$reviewedSha,targetRunId:$targetRunId,targetRunAttempt:$targetRunAttempt,codeqlRunId:$codeqlRunId,artifacts:.}' \
  "$index_parts" > "$index_path"
rm -f "$index_parts"

echo "Provenance evidence collection PASS: TARGET run ${GITHUB_RUN_ID}, CodeQL run ${codeql_run_id}, 6 exact-head artifacts."

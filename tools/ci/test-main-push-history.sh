#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
validator="${script_dir}/validate-main-push-history.sh"
test_root="$(mktemp -d)"
trap 'rm -rf "$test_root"' EXIT

repo="${test_root}/repo"
git init -q -b main "$repo"
git -C "$repo" config user.name "Regression Test"
git -C "$repo" config user.email "regression@example.invalid"

printf 'base\n' >"${repo}/history.txt"
git -C "$repo" add history.txt
git -C "$repo" commit -q -m "base"
base_sha="$(git -C "$repo" rev-parse HEAD)"

git -C "$repo" switch -q -c feature-valid
printf 'feature\n' >>"${repo}/history.txt"
git -C "$repo" commit -qam "feature"
git -C "$repo" switch -q main
GIT_COMMITTER_NAME=GitHub GIT_COMMITTER_EMAIL=noreply@github.com git -C "$repo" merge -q --no-ff feature-valid -m "Merge pull request #1 from test/feature-valid"
valid_head="$(git -C "$repo" rev-parse HEAD)"
valid_result="$(cd "$repo" && bash "$validator" "$base_sha" "$valid_head")"
if [ "$valid_result" != "$valid_head" ]; then
  echo "Expected the valid merge-only range to return exactly its merge commit." >&2
  exit 1
fi

printf 'direct\n' >>"${repo}/history.txt"
git -C "$repo" commit -qam "direct commit that must be detected"
direct_sha="$(git -C "$repo" rev-parse HEAD)"
git -C "$repo" switch -q -c feature-after-direct
printf 'feature-after-direct\n' >>"${repo}/history.txt"
git -C "$repo" commit -qam "feature after direct commit"
git -C "$repo" switch -q main
GIT_COMMITTER_NAME=GitHub GIT_COMMITTER_EMAIL=noreply@github.com git -C "$repo" merge -q --no-ff feature-after-direct -m "Merge pull request #2 from test/feature-after-direct"
bypass_head="$(git -C "$repo" rev-parse HEAD)"

if (cd "$repo" && bash "$validator" "$valid_head" "$bypass_head" >/dev/null 2>&1); then
  echo "Validator accepted a direct commit hidden before a valid-looking merge." >&2
  exit 1
fi
if [ -z "$direct_sha" ]; then
  echo "Regression fixture failed to create the direct commit." >&2
  exit 1
fi

echo "Main push history regression PASS."

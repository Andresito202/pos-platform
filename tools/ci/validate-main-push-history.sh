#!/usr/bin/env bash
set -euo pipefail

before_sha="${1:-}"
head_sha="${2:-}"
zero_sha="0000000000000000000000000000000000000000"

if ! [[ "$before_sha" =~ ^[0-9a-f]{40}$ ]] || [ "$before_sha" = "$zero_sha" ]; then
  echo "::error::main push has no valid pre-push SHA; the compensating control cannot prove the introduced first-parent range." >&2
  exit 1
fi
if ! [[ "$head_sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "::error::main push has no valid head SHA." >&2
  exit 1
fi
if ! git cat-file -e "${before_sha}^{commit}" 2>/dev/null; then
  echo "::error::pre-push main commit ${before_sha} is unavailable in the checkout." >&2
  exit 1
fi
if ! git cat-file -e "${head_sha}^{commit}" 2>/dev/null; then
  echo "::error::pushed main commit ${head_sha} is unavailable in the checkout." >&2
  exit 1
fi
if ! git merge-base --is-ancestor "$before_sha" "$head_sha"; then
  echo "::error::main push is not a fast-forward from ${before_sha} to ${head_sha}." >&2
  exit 1
fi

mapfile -t introduced_mainline_commits < <(git rev-list --first-parent --reverse "${before_sha}..${head_sha}")
if [ "${#introduced_mainline_commits[@]}" -eq 0 ]; then
  echo "::error::main push introduced no verifiable first-parent commit." >&2
  exit 1
fi

expected_parent="$before_sha"
for commit_sha in "${introduced_mainline_commits[@]}"; do
  parents="$(git show -s --format=%P "$commit_sha")"
  parent_count="$(awk '{print NF}' <<<"$parents")"
  first_parent="$(awk '{print $1}' <<<"$parents")"
  if [ "$first_parent" != "$expected_parent" ]; then
    echo "::error::main first-parent chain is discontinuous at ${commit_sha}; expected parent ${expected_parent}, found ${first_parent}." >&2
    exit 1
  fi
  # GitHub creates 2-parent merge commits and 1-parent squash merges.
  # Neither is sufficient evidence on its own: the workflow MUST additionally
  # match each SHA against GitHub's merged-PR API (merge_commit_sha + base main).
  # Direct pushes, local squash commits and rebase histories remain rejected.
  if [ "$parent_count" -ne 1 ] && [ "$parent_count" -ne 2 ]; then
    echo "::error::main commit ${commit_sha} has ${parent_count} parents; only GitHub merge/squash commits are eligible." >&2
    exit 1
  fi
  committer_email="$(git show -s --format=%ce "$commit_sha")"
  committer_name="$(git show -s --format=%cn "$commit_sha")"
  if [ "$committer_email" != "noreply@github.com" ] || [ "$committer_name" != "GitHub" ]; then
    echo "::error::main commit ${commit_sha} was not created by GitHub." >&2
    exit 1
  fi
  expected_parent="$commit_sha"
done

if [ "$expected_parent" != "$head_sha" ]; then
  echo "::error::validated first-parent range did not terminate at the pushed main SHA." >&2
  exit 1
fi
printf '%s\n' "${introduced_mainline_commits[@]}"

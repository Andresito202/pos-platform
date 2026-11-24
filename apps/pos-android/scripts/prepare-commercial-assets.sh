#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
lab="$root/tools/android-lab-probes"
dest="$root/apps/pos-android/src/main/assets/runtime"
test -f "$lab/build/runtime-assets/runtime/files.json" || {
  echo "Build lab runtime assets first (prepare/extract/compile/package)." >&2
  exit 1
}
rm -rf "$dest"
mkdir -p "$(dirname "$dest")"
cp -a "$lab/build/runtime-assets/runtime" "$dest"
echo "Commercial runtime assets ready: $dest"

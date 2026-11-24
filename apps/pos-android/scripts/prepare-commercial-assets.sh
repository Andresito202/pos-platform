#!/usr/bin/env bash
set -euo pipefail
# Stage runtime assets into a gitignored path for commercialApk.
# Do not leave better-sqlite3 under apps/pos-android source roots scanned by ARCH-003.
root="$(cd "$(dirname "$0")/../../.." && pwd)"
lab="$root/tools/android-lab-probes"
dest="$root/apps/pos-android/build/staging-runtime"
test -f "$lab/build/runtime-assets/runtime/files.json" || {
  echo "Build lab runtime assets first (prepare/extract/compile/package)." >&2
  exit 1
}
rm -rf "$dest"
mkdir -p "$(dirname "$dest")"
cp -a "$lab/build/runtime-assets/runtime" "$dest"
echo "Commercial runtime assets ready: $dest"

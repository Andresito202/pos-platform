#!/usr/bin/env bash
# Exercise the real signing and verification path using an ephemeral lab key.
set -euo pipefail
umask 077
input="$(realpath -- "$1")"
test -f "$input"
lab_key="$(mktemp -d)"
trap 'rm -rf -- "$lab_key"' EXIT
export CAMACHO_ANDROID_RELEASE_STORE_PASSWORD="$(openssl rand -hex 24)"
export CAMACHO_ANDROID_RELEASE_KEY_PASSWORD="$CAMACHO_ANDROID_RELEASE_STORE_PASSWORD"
export CAMACHO_ANDROID_RELEASE_ALIAS=camacho-lab
export CAMACHO_ANDROID_RELEASE_KEYSTORE="$lab_key/lab.p12"
keytool -genkeypair -keyalg RSA -keysize 2048 -validity 2 -dname 'CN=Camacho POS CI Laboratory' \
  -alias "$CAMACHO_ANDROID_RELEASE_ALIAS" -storetype PKCS12 -keystore "$CAMACHO_ANDROID_RELEASE_KEYSTORE" \
  -storepass:env CAMACHO_ANDROID_RELEASE_STORE_PASSWORD
keytool -exportcert -alias "$CAMACHO_ANDROID_RELEASE_ALIAS" -keystore "$CAMACHO_ANDROID_RELEASE_KEYSTORE" \
  -storepass:env CAMACHO_ANDROID_RELEASE_STORE_PASSWORD -file "$lab_key/lab.der"
export CAMACHO_ANDROID_RELEASE_CERT_SHA256="$(sha256sum "$lab_key/lab.der" | cut -d' ' -f1)"
export CAMACHO_ANDROID_UNSIGNED_APK_SHA256="$(sha256sum "$input" | cut -d' ' -f1)"
export CAMACHO_ANDROID_UNSIGNED_APK="$input"
bash tools/android-runtime/gradle-with-network-retry.sh commercialReleaseApk

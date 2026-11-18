import { describe, expect, it } from "vitest";
import { isAbsolute, normalize, relative, join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  prepareWindowsHandoffReceiver,
  prepareWindowsServiceSigner,
  recoverWindowsServiceSignerPublic,
  recoverWindowsHandoffReceiverPublic,
} from "@pos-platform/local-channel";

/**
 * Explicit, one-time *operator* enrollment for the isolated SCM VM only.
 * Never run during normal test suites, CI, app startup, or user login.
 * No identities/UUIDs are fabricated; DPAPI uses actual CurrentUser token.
 * Private material never leaves the corresponding OS identity.
 */
const enabled = process.platform === "win32" &&
  process.env.CAMACHO_SCM_EXPLICIT_OPERATOR_ENROLL === "1";

function requirePath(path: string | undefined, parent: string): string {
  if (!path || !isAbsolute(path) || normalize(path) !== path ||
      !/^[a-z]:\\/i.test(path)) throw Error("SCM_OPERATOR_PATH_INVALID");
  const rel = relative(parent, path);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) {
    throw Error("SCM_OPERATOR_PATH_OUTSIDE_PRIVATE_CUSTODY");
  }
  return path;
}

describe("explicit Windows SCM operator DPAPI enrollment (not certification)", () => {
  it.skipIf(!enabled)("enrolls one real role exactly once", () => {
    const role = process.env.CAMACHO_SCM_ENROLL_ROLE;
    if (role !== "SERVICE" && role !== "DESKTOP") throw Error("SCM_OPERATOR_ROLE_REQUIRED");
    const root = process.env.CAMACHO_SCM_LAB_ROOT;
    if (!root || !/^[a-z]:\\CamachoPosScmLab\\[a-f0-9]{32}$/i.test(root) ||
        normalize(root) !== root) throw Error("SCM_OPERATOR_ROOT_REJECTED");
    const parent = join(root, role === "SERVICE" ? "service" : "desktop", "private");
    const privateFile = requirePath(process.env.CAMACHO_SCM_OPERATOR_PRIVATE_FILE, parent);
    const publicFile = requirePath(process.env.CAMACHO_SCM_OPERATOR_PUBLIC_FILE, parent);
    if (privateFile.toLowerCase() === publicFile.toLowerCase()) throw Error("SCM_OPERATOR_PATH_COLLISION");
    const installationId = process.env.POS_INSTALLATION_ID ?? "";
    const deviceId = process.env.POS_DEVICE_ID ?? "";
    const privateExists = existsSync(privateFile);
    const publicExists = existsSync(publicFile);
    if (privateExists !== publicExists) throw Error("SCM_OPERATOR_PARTIAL_ENROLLMENT_STOP");
    if (privateExists) {
      // Same real Windows user/service DPAPI token, no rotation or rewrite.
      const recovered = role === "SERVICE"
        ? recoverWindowsServiceSignerPublic(privateFile, installationId, deviceId)
        : recoverWindowsHandoffReceiverPublic(privateFile, installationId, deviceId);
      const existing = JSON.parse(readFileSync(publicFile, "utf8"));
      if (JSON.stringify(recovered) !== JSON.stringify(existing)) throw Error("SCM_OPERATOR_PUBLIC_RECOVERY_PIN_MISMATCH");
      expect(existsSync(privateFile)).toBe(true);
      return;
    }
    const value = role === "SERVICE"
      ? prepareWindowsServiceSigner(privateFile, installationId, deviceId)
      : prepareWindowsHandoffReceiver(privateFile, installationId, deviceId);
    writeFileSync(publicFile, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    expect(existsSync(privateFile)).toBe(true);
    expect(existsSync(publicFile)).toBe(true);
  }, 45000);
});

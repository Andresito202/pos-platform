import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Select only the requested service profile. A missing SCM_CANDIDATE must
 * never silently package the INTERACTIVE service instead.
 * No filesystem mutations or downloads take place here.
 */
export function resolveNsisServiceArtifact(artifactDir, profile, fileExists = existsSync) {
  if (profile !== undefined && profile !== "INTERACTIVE" && profile !== "SCM_CANDIDATE") {
    throw new Error("NSIS_SERVICE_PROFILE_REJECTED");
  }
  const scm = profile === "SCM_CANDIDATE";
  const file = join(
    artifactDir,
    scm
      ? "pos-local-service-0.0.0-win32-x64-scm-candidate.tar.gz"
      : "pos-local-service-0.0.0-win32-x64.tar.gz",
  );
  if (!fileExists(file)) {
    throw new Error(
      scm
        ? "SCM_CANDIDATE_ARTIFACT_MISSING: build the SCM_CANDIDATE service artifact before NSIS packaging"
        : "LOCAL_SERVICE_ARTIFACT_MISSING: build the INTERACTIVE service artifact before NSIS packaging",
    );
  }
  return { artifact: file, profile: scm ? "SCM_CANDIDATE" : "INTERACTIVE" };
}

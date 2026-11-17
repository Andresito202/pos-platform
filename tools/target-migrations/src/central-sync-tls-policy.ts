/**
 * DEC-024 internal enforcement for central-sync-server listen policy.
 *
 * Production TLS termination stays outside this process (reverse proxy).
 * This module fail-closes insecure exposure: non-loopback binds require an
 * explicit attestation that a TLS terminator sits in front. Lab may bind
 * loopback HTTP only. Certificate validation on the client (SyncDispatcher)
 * remains mandatory https:// — never disabled here.
 */

export type CentralSyncTlsMode = "lab" | "production";

export type CentralSyncListenDecision = {
  readonly mode: CentralSyncTlsMode;
  readonly host: string;
  readonly port: number;
  readonly behindTlsTerminator: boolean;
  readonly certificationScope: "LABORATORY" | "PRODUCTION_REQUIRES_PROXY_TLS";
};

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

export function resolveCentralSyncListenPolicy(env: NodeJS.ProcessEnv = process.env): CentralSyncListenDecision {
  const modeRaw = (env.CENTRAL_SYNC_TLS_MODE ?? "lab").trim().toLowerCase();
  if (modeRaw !== "lab" && modeRaw !== "production") {
    throw new Error("CENTRAL_SYNC_TLS_MODE must be lab|production");
  }
  const mode = modeRaw as CentralSyncTlsMode;
  const host = (env.CENTRAL_SYNC_BIND_HOST ?? "127.0.0.1").trim();
  const port = Number(env.PORT ?? 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a valid TCP port");
  }
  const behindTlsTerminator = env.CENTRAL_SYNC_BEHIND_TLS_TERMINATOR === "1";

  if (mode === "lab") {
    if (!isLoopback(host) && !behindTlsTerminator) {
      throw new Error(
        "DEC024_LAB_REFUSES_INSECURE_EXPOSURE: lab mode may bind non-loopback only when CENTRAL_SYNC_BEHIND_TLS_TERMINATOR=1",
      );
    }
    return {
      mode,
      host,
      port,
      behindTlsTerminator,
      certificationScope: behindTlsTerminator ? "PRODUCTION_REQUIRES_PROXY_TLS" : "LABORATORY",
    };
  }

  // production
  if (!behindTlsTerminator) {
    throw new Error(
      "DEC024_PRODUCTION_REQUIRES_TLS_TERMINATOR: set CENTRAL_SYNC_BEHIND_TLS_TERMINATOR=1 and terminate TLS outside central-sync-server",
    );
  }
  if (env.CENTRAL_SYNC_ALLOW_INSECURE_HTTP === "1") {
    throw new Error("DEC024_INSECURE_HTTP_OVERRIDE_FORBIDDEN");
  }
  return {
    mode,
    host,
    port,
    behindTlsTerminator: true,
    certificationScope: "PRODUCTION_REQUIRES_PROXY_TLS",
  };
}

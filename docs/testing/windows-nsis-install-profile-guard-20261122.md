# Windows NSIS: commercial release boundary (2026-11-22)

## Verified scope of this change

The existing NSIS installer cannot be called a production release: the
SERVICE/DESKTOP authenticated channel remains unproven on physical Windows
and the distributor signing custody has not been established.

This change deliberately **blocks installer production**, rather than
installing a diagnostic WinSW service or accepting unverified keys.

- `pack-windows-nsis.mjs` validates the commercial release profile before
  staging or invoking electron-builder.
- No user-controlled environment flags override
  `SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN`.
- The NSIS `customInstall` hook refuses installation even if electron-builder
  is invoked directly, instead of installing any diagnostic service.
- The elevated WinSW helper has no sample installation, device, tenant, company,
  or branch identifiers and no fallback to a lab data directory.
- Commercial install requests fail before touching service registry, markers,
  XML, or SQLite directory. `Status` and `Uninstall` paths retain their
  existing behavior for servicing previously installed systems.
- The prior unsigned installer generation/diagnostic lifecycle workflow is
  retired. Windows CI now validates non-installing refusal and PowerShell
  syntax without producing an installer artifact.

## Evidence and limits

CI regression is not physical certification. Remaining requirements:
1. Establish real SERVICE/DESKTOP identities and protected key custody.
2. Validate Windows ACLs, native adapter identity, revocation and recovery
   with the real Electron user session.
3. Complete signed, audited installer/release workflow with Authenticode.
4. Only then replace the unconditional gate in a dedicated reviewed PR,
   accompanied by machine evidence, never by manually supplied ready flags.

**Release status: BLOCKED.** Do not claim a working commercial installer.

# WinSW/NSIS: explicit installation profile guard (2026-11-22)

Scope: **safety guard only**, not commercial enrollment, certification, or a signed installer.

- The Windows NSIS hook explicitly passes `-InstallProfile LAB` to the existing
  WinSW helper. The LAB path still uses `ProgramData\\CamachoPOS\\lab-data`
  when no data directory is supplied. It remains a diagnostic installer, **not a
  commercial Windows installation**.
- Direct `-Action Install` without `-InstallProfile` fails with
  `INSTALL_PROFILE_REQUIRED`. `Status` and `Uninstall` continue to work
  without a profile.
- Explicit `-InstallProfile COMMERCIAL` rejects a missing data directory,
  non-absolute path, named lab/preproduction path segments, and the built-in
  sample tenant/installation/device identifiers.
- Even with valid operator inputs, `COMMERCIAL` remains blocked by
  `SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN`, before changes to
  SCM, the WinSW XML, the success markers, or local SQLite directories. The
  helper may still write ordinary diagnostic logs.
- No DPAPI identity, key, SID, access-control list, or provisioning JSON is
  created by this change. No production installation has been performed.

This intentionally does **not** replace the physical provisioning/certification
work required for commercial activation. Do not attempt to bypass the release
gate or use the lab installer as production. The existing NSIS lab lifecycle
remains a separate test.

Regression entrypoint:
`node --test tools/operators/nsis-commercial-install-profile.test.mjs`
(included in `ci:supply-chain-tests`).

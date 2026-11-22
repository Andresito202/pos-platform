# Windows SCM: verified candidate-record recovery (2026-11-22)

This change extends the existing immutable, installer-owned candidate store with an **operator-only read path**, not an SCM/Electron runtime capability.

## Trust and failure model

- The existing candidate file must already exist in a pre-provisioned local Windows directory. Nothing is created, repaired, replaced or rotated during recovery.
- A native PowerShell reader requires an elevated operator token and checks canonical local paths, reparse points, protected ACLs, restricted SYSTEM/Administrators owner/access and a held file handle during reading.
- The Node coordinator refuses missing files, invalid native output, noncanonical Base64, mismatched or missing external SHA-256, expired provision metadata, invalid service/desktop bindings and an independently supplied minimum revision greater than the recovered revision.
- The expected SHA-256 and minimum revision **must come from a separate authenticated installer policy or stronger protected monotonic store**. The file being recovered is not allowed to certify itself. This module does not create or attest that trust anchor.
- A successful recovery reports `CANDIDATE_RECOVERED_NOT_AUTHORIZED` with `commercial_ready:false`, and never returns or releases credentials, keys, or a commercial activation signal.
- Both native writer and reader are covered by Windows syntax checks; negative tests exercise injected output without changing Windows files.

## Remaining blockers

The real Windows ACL/ownership/read lifecycle has **not** been exercised on the intended physical machine. Likewise, a signed policy, durable monotonic revision store, cross-role deployment, protected key rotation and repair, reboot/upgrade recovery, native SERVICE ↔ DESKTOP session interoperability, revocation and Authenticode release signing remain unproven.

The existing `SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN` guard remains mandatory and unchanged. Do **not** regard candidate recovery as commercial certification.

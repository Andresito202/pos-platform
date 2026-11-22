# SCM SERVICE/DESKTOP: trust-boundary hardening — 2026-11-22

This change hardens the existing read-only provisioning verifier without
creating another runtime, operator login, or laboratory installation.

## Validation added

- Refuse the known sample installation/device identifiers.
- Refuse identical installation/device IDs.
- Reject nested SERVICE and DESKTOP private-key custody roots, not only
  identical parent directories.
- Reject conflicting native-adapter paths or digests between the two
  provisions. Each provision must still match its own pinned SHA-256.
- Keep exact schema validation, Ed25519/RSA public key pins, SID binding,
  validity windows and canonical managed paths.

The verifier never opens private key files, writes provision files or changes
Windows ACLs. Its result remains `commercial_ready: false`. The runtime and
NSIS release gates remain unconditional.

## Still required before commercial activation

- An independently authenticated Windows enrollment workflow binding the
  actual SCM service SID and the actual logged-in DESKTOP user SID/session.
- Protected private key creation/custody, least-privilege ACLs, and replay/
  revocation persistence on physical Windows.
- Real end-to-end SCM ↔ Electron session evidence, including reboots,
  password/login, revocation, rollback, and upgrade recovery.
- A signed release using audited Authenticode key custody.

Do not merge this PR as evidence that these missing functions are complete.

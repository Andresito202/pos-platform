# Windows SCM: pairing existing public enrollment receipts (2026-11-22)

## Scope

Existing `prepareWindowsServiceSigner` and
`prepareWindowsHandoffReceiver` create protected private keys under their
respective Windows identities. They must be run only with their correct
operating-system tokens and controlled directories.

`assembleScmPublicEnrollmentPair` consumes *only public receipts* from
`recoverWindowsServiceSignerPublic` and
`recoverWindowsHandoffReceiverPublic`, and operator-supplied approved
metadata. It validates receipt bindings, Ed25519/RSA public pins,
distinct installation/device IDs, service SID consistency, native adapter
SHA-256, custody path separation, time window and strict schema via the
existing read-only preflight.

The candidate pair is not written to the filesystem and is **not** release
authority. `commercial_ready` remains `false`; this module does not
write private key material, grant ACLs, alter Windows service configuration,
create SQLite data, or connect Electron.

## Required next steps

1. Establish the authorized installer-owned policy and protected public
   provision persistence (with atomic writes, restrictive ACLs, and rollback
   prevention). Reject public receipts whose real Windows token, session
   or ownership cannot be independently verified.
2. Exercise both protected-key recovery functions under the actual service
   identity and desktop user identity on the physical Windows target.
3. Prove native Windows pipe peer identity, signed one-use handoff,
   durable replay/revocation, restart and session-change behavior.
4. Certify Authenticode signing and distribution.

Do not use this candidate as evidence of commercial certification or remove
`SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN`.

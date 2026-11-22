# SCM provisioning: immutable candidate record (2026-11-22)

## Scope

The repository already has functions for protected SERVICE signer and DESKTOP receiver keys, public enrollment receipts and pair validation. This change introduces a **create-once, installer-owned candidate record**, never a runtime authorization mechanism.

- `serializeScmCandidate` validates both roles, public key pins, SID bindings, native adapter SHA-256 and expiry using the existing preflight.
- `persistInitialScmCandidate` runs on Windows only and requires a **preexisting privileged directory**; it will not create an insecure directory or overwrite an existing record.
- The elevated PowerShell writer rejects reparse points, paths associated with testing, unprotected root ACLs and write access for non-administrator/SYSTEM identities.
- A temporary file is created with an explicit protected ACL, flushed, then renamed **on the same volume** to `candidate-pair.json`. A preexisting target or concurrent winning writer is not overwritten.
- No private key material is read, exported or stored. The file is public provisioning metadata and remains `CANDIDATE_NOT_AUTHORIZED`.
- There is deliberately **no update or rollback operation**: an existing record (including invalid/corrupt state) blocks fresh enrollment. Introducing key rotation requires an independently signed authorization and a reviewed monotonic, durable policy.

## Important security limitations

This is only a first-enrollment persistence primitive. In particular, it does not construct a Windows ACL-protected directory or attest an operator approval, and no existing runtime consumer is enabled. It does not solve atomic cross-role deployment or disaster recovery. Validate actual Windows parent ACLs and filesystem semantics before invoking it on a commercial machine.

The physical SCM↔Electron interop, durable replay/revocation, full installation orchestration, release signing and certificate custody are still **NOT PROVEN**. The runtime and NSIS fail-closed gates stay unchanged.

The operator must not run this action on the currently installed machine until its target path, authorized policy, custody and recovery workflow have been reviewed and independently approved.

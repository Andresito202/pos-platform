# SCM: signed policy boundary, not commercial enablement

Base: `main@843c692e6ef34d89e6efa3ac91bc964faf3b3bf5`; PRs #120–#124 MERGED, with the six workflows recorded on that merge SUCCESS. The owner authorized one new branch and a Draft PR for this continuation, superseding the older active-branch selection only for this scope. No service installation, key generation, ACL modification or runtime gate change is authorized by a successful metadata/policy check.

## Implementation and evidence matrix

| Capability | Existing implementation reused | Evidence available | Real integration | Remaining blocker |
|---|---|---|---|---|
| Pair/adapter/public-key binding | scm-provision-preflight; scm-public-enrollment-pair | PRs #120–#122 tests/CI | Operator metadata path | No approved physical pair |
| Immutable persistence/recovery | scm-immutable-provision-store; native writer/reader | #123/#124 CI; protected PS parser | Create-once candidate; read-only recovery | No installed commercial store; native custody not observed here |
| Signed approval | New contract/verifier; existing canonicalJson, Ed25519 and managed reader | 12 targeted cases with real cryptography and OS/file-boundary doubles | New operator reader derives candidate pin/revision from verified files | Issuer/private-key custodian and authenticated root provisioning remain undefined |
| Monotonic revision | External checkpoint compared by verifier | Prior/skipped/wrong-parent revision negatives | Current revision required for recovery; exact next revision for rotation intent | Durable installer checkpoint transaction and anti-rollback restore are NOT implemented or certified |
| Revocation | New trusted checkpoint lists and trust generation; existing lease ledger | Policy/key revocation negatives; historical lease tests | Reader rejects revoked IDs/authority pins and obsolete trust generation | Publishing fresh checkpoint, active-connection propagation and freshness on reboot/suspend remain pending |
| SERVICE key / DESKTOP receiver | Existing recoverWindowsServiceSignerPublic / recoverWindowsHandoffReceiverPublic; DPAPI CurrentUser | Historical isolated/native CI evidence | Existing custody readers, no new private-key path | No legitimate commercial enrollments on this computer |
| Native peer / pipe / signed capsule | windows-native-pipe, windows-pipe.cc, windows-scm-client, windows-handoff, WindowsScmChannelTransport | Prior Windows runner tests; #117 launch repair | Original service component and Electron entry select SCM; main still denies commercial SCM | Physical SERVICE + original Electron handoff/revoke/restart/change-user/suspend proof |
| Windows SCM / NSIS | Original WinSW descriptor and install helper | Prior NSIS runner evidence | Commercial installation and main retain unconditional NOT_PROVEN guards | CamachoPOSLocalService absent; never reuse old PosLocalService |
| Authenticode / distribution | Existing binary payload and integrity mechanism | Local addon and Electron executable return NotSigned | No signing/distribution performed | No authorized signing certificate/custodian identified; release remains blocked |

## What is connected by this patch

`recoverScmCandidateWithSignedPolicy` → existing Windows managed-file reader for external trust/checkpoint and signed policy → real Ed25519 verification → existing protected candidate recovery → exact digest/revision/installation/device/policy-reference binding. The approval authority must differ from the candidate Service signer. The result remains `CANDIDATE_RECOVERED_NOT_AUTHORIZED`, `commercial_ready:false`; it cannot open a service, channel or commercial session.

The two new schemas live in contracts, verification in local-channel, and the operator consumer in tools/operators. There is no second authentication system, issuer, POS, service or permission matrix. Session trust explicitly signs SESSION_ASSERTION keys; licensing artifacts use their own purposes/scopes. Neither is treated as an SCM authority. Only canonical serialization and cryptographic primitives are reused.

## External root and division of responsibility

- The issuing authority and custodian of its private approval key remain an explicit owner decision. No key, SID, root file path or production policy is supplied by the repository. There is no issuance/signing implementation or production signing key in this change.
- The approved installer must authenticate and provision a separate public trust/checkpoint file, with the existing managed-file ACL/owner/ancestor requirements, before any operational use. The trust includes installation/device scope, a pinned Ed25519 SPKI, validity, trust generation, current candidate digest/revision and revoked policy IDs/authority pins. A policy/capsule/candidate or a CLI/env hash cannot become its own root. The verifier rejects private PEM input as a public root.
- SYSTEM/installer administration owns checkpoint publication and audit. SERVICE and DESKTOP may read only their approved material; neither may advance the high-water mark, replace roots or issue approval. Service private signing and Desktop RSA receiver material stay in their existing separate DPAPI CurrentUser custody. This patch changes no Windows ACL.
- File ownership alone does not certify the selected issuer or prove checkpoint freshness. The installer must obtain an authenticated current high-water mark and preserve it through recovery/rollback. A restored old but once-valid checkpoint is NOT detected by a stateless signature verifier. That durable external mechanism is a deployment blocker, not solved by supplying a number to this API.

## Signed contract, monotonicity and revocation

Signatures cover the existing canonical JSON representation of all policy fields, prefixed by `CAMACHO_SCM_APPROVAL_SIGNATURE_V1` and a NUL byte. Envelopes are strict, bounded and contain no issuer public key. Only the separately authenticated trust file supplies that key. The signature is canonical Base64URL/64-byte Ed25519; profile/service/scope/trust-generation/window/pin/signature checks all precede recovery.

Recovery requires the exact checkpoint digest and policy revision. A rotation intent must be separately signed, reference the current predecessor digest, change the digest and request exactly revision + 1. No overwrite, release flag or automatic key rotation is accepted. Even a valid rotation intent is rejected by the read-only recovery consumer with `SCM_ROTATION_INSTALLER_TRANSACTION_REQUIRED`.

Applying rotation remains blocked until a reviewed installer transaction can durably commit the successor plus audit and new high-water checkpoint, preserve prior immutable evidence, serialize concurrent publication, and fail closed after partial failure. It must preserve existing keys unless a separately authorized rotation specifically requires a replacement. The new verifier does not create this transaction and does not pretend that signature verification is persistence.

Revocation belongs to an authenticated newer trust generation: revoke policy IDs and/or authority pins and advance the checkpoint without lowering revisions. Older policies fail against that generation. SERVICE must later map revocation into the existing durable lease revocation/connection-close authority; DESKTOP must later revalidate freshness at reconnect/logon/resume. These runtime consumers remain blocked until that integration and physical evidence exist. There is no network revocation service or new database in this patch.

## Execution observed on this PC

- Main and origin/main matched the requested base. Tracked tree was clean; .claude-desactivado, Android/native and data were preserved. No existing branch was reused.
- CamachoPOSLocalService is absent. Only old PosLocalService is registered, Stopped/Disabled; it was neither started nor modified. Current token is not elevated. No SERVICE/DESKTOP provision variable or commercial installation was located in the inspected product paths. No physical handoff test ran; a SKIP is not counted as PASS.
- Existing native addon SHA-256: `f9d3790b154eda0c5c5156f5e38071362c3684d24730280ad4683ad0bf675e03`, signature NotSigned. Existing Electron executable SHA-256: `1432afee01d6a788f11cb6649efd271923e1e490beef688c24d31f47965013aa`, signature NotSigned. These are inventory, not approved adapter pins, provenance or commercial certification. No code-signing certificate was returned by the inspected CurrentUser/LocalMachine My stores; no private key was accessed.
- New policy suite: 12 PASS; real disposable Ed25519 fixtures, managed Windows reads/candidate I/O doubled. Existing affected store suite: 10 PASS, including one new binding case and native reader/writer parser checks; no Windows file/ACL mutation.
- Local-channel and contracts typecheck PASS; ARCH-003 PASS. An initial test import failed because tools/operators has no local-channel workspace dependency; it was corrected to the existing source module path without adding dependencies or suppressing errors.
- Unchanged DPAPI, lease, native kernel, login and installer suites reuse their historical evidence. They are not re-executed or upgraded to physical product proof by these policy tests.

## Review and release condition

Review the cryptographic domain, exact checkpoint binding, no-root failure, revocation/floor negatives and separation from the unchanged runtime gate. The Draft PR is an independently reviewable contract/read-only integration increment, not an authorization to install, enable or distribute. Product acceptance remains blocked by issuer/root custody decisions, a durable monotonic installer publication/rotation/revocation mechanism, authorized physical installation and original-Electron handoff/restart/revoke tests, and release-signing custody. No merge or commercial completion is requested.

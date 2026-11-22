# SCM Central / SERVICE integration - PR #127

## Scope and status

Owner authorization: 2026-11-22. Only branch `codex/scm-real-integration-20261122`, baseline `3da69e307c6d687098b2a20fc3797bc65c293f70`, existing Draft PR #127. No merge. No commercial enablement. This update supersedes the historical active-line selection for this specific task.

The runtime wiring is IMPLEMENTED behind the unchanged `SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN` gate. It does not establish physical Windows interoperability, authenticated installer provisioning, service recovery, or production operation.

## Existing components reused

- Central HTTPS listener, PostgreSQL pool and migration checksum/lock runner.
- `ScmCheckpointIssuer`, complete checkpoint signing bytes and independent-root Ed25519 verifier.
- DeviceProof exact method/path/body signature, ACTIVE device/credential lookup, transactional nonce/request replay ledger from migration 012.
- SERVICE encrypted device identity, enrolled credential provider and encrypted secret store with existing DPAPI custody.
- Immutable candidate-pair bytes, managed Windows file reader, signed recovery policy and native adapter pinning.
- Existing SQLite lease ledger, transport frame authenticator, per-request admission, native pipe and Electron client close handling. No second Electron transport or UI.

## Central publication and authenticated API

Migration `034_scm_checkpoints` is a registered successor of 033 in the existing commercial runner. It adds append-only history in `platform.scm_checkpoints`, owned by `pos_schema_owner`; only Central `pos_platform_app` receives SELECT/INSERT. Other runtime roles receive no access. UPDATE/DELETE/TRUNCATE are denied and guarded. Automated down refuses to remove revocation history.

Existing command: `pnpm --filter @pos-platform/target-migrations postgres:commercial:apply -- --scm-checkpoints`. Existing mandatory migration environment variables and exact SHA/registered predecessor checks still apply. This command was NOT run against an operator database in this session.

`CENTRAL_SCM_PROVISION_FILE` selects an operator-managed JSON file containing:

```json
{
  "signer_private_file": "<absolute Central-only signer path>",
  "root_public_key_file": "<absolute independently provisioned public root path>",
  "checkpoints": ["<WindowsScmPolicyTrust objects, not strings>"]
}
```

The example describes fields; it is not an executable provision. No keys, tokens or seed records are included. The root must match the Central Ed25519 signer and each checkpoint's authority. The existing issuer signs the complete checkpoint, then publication takes a per-installation/device PostgreSQL transaction lock. Identical replay is idempotent; conflicting/superseded revisions and removal of revocations reject. Current implementation permits revision 1 and consecutive revocation-only successors with the same root, candidate, policy revision and validity window. Candidate/root rotation and validity renewal require an explicit installer transition; they are not silently authorized by this API. On restart, supply the latest checkpoint or its identical replay; an obsolete provision refuses startup instead of restoring old authority.

`POST /v1/scm/checkpoint` accepts only exact UTF-8 `{}` with `DeviceProof`, UUID request/correlation headers and JSON content type. DeviceProof determines installation/device; no caller-provided scope is accepted. The endpoint consumes proof replay state, reads the latest persisted checkpoint and returns the signed envelope with `cache-control: no-store`. It does not accept publication or commercial grants. Bounds: 1 KiB request, 600 requests/minute per remote address, 30/minute per authenticated device. Standard 5-second SERVICE polling supports 30 boxes behind one address without sharing a per-device quota. Wrong credentials, revoked device credentials, missing publication and database failures return no authority.

## SERVICE consumer and Electron revocation

The SERVICE configuration accepts `POS_WINDOWS_SCM_CENTRAL_PROVISION_FILE` in addition to the existing SCM handoff file. The managed JSON contains `origin` (exact HTTPS origin), `root_public_key_pem`, `root_spki_sha256`, `candidate_file` and `policy` (existing signed RECOVER_CANDIDATE envelope). The root must be independently installed, distinct from the SERVICE capsule signer. Neither downloaded checkpoint nor candidate supplies its own root.

`LocalChannelComponent` builds `ScmCentralCheckpointGuard` using the already enrolled device credential, encrypted identity and secret store. Missing provision/credentials fail closed. It validates live HTTPS publication before native listen, authenticates signature and scope, checks a persisted encrypted rollback floor, saves revocations BEFORE evaluating the recovery policy, verifies signed candidate digest and exact SERVICE provision binding. The cached checkpoint is never an offline admission credential.

SERVICE polls every 5 seconds with a 5-second request deadline, bounded response streaming (64 KiB), redirects denied and normal TLS certificate verification. No overlapping requests. Every transport admission/request also checks current authority and the 11-second monotonic stale limit. Revocation or network/durability failure marks authority invalid, destroys all Electron transport sockets, stops native admission and clears cached lease/master secrets using the existing stop lifecycle. A restart requires a new live authenticated check; it cannot recover admission from the cached floor alone. No automatic restart loop or authority reconstruction was added.

This SCM transport requires online authority; this change does not alter the existing non-SCM local-first sales path. Signed checkpoints alone cannot prove freshness after a joint restore of Central and local history. Independent infrastructure custody/restore policy and physical Windows evidence remain required.

## Observed validation

Local Windows / Node 22.19.0:

- New API cases: 6 passed initially; additional per-device limiter case executed separately after its implementation.
- New SERVICE checkpoint and socket-stop cases: 10 passed.
- New Central issuer cases: 2 passed.
- Typechecks: Central, SERVICE and migration runner passed before the final documentation update; final status belongs to the PR HEAD checks.
- `git diff --check`: clean when inspected.
- ARCH-003 found an existing cross-project test import from local-channel into Central. Local-channel now signs verifier fixtures locally; Central issuer tests live under Central. Executable boundary validation passed after the fix. The historical verifier cases were not rerun locally.
- The 16 historical architecture-validator tests were also executed inadvertently; they passed. This was an unnecessary repeat, not new SCM evidence.
- New real PostgreSQL/HTTPS integration file: 3 cases skipped locally because no explicit disposable database was provisioned. Docker daemon access from this session was denied. No local PostgreSQL integration PASS is claimed.

`.github/workflows/scm-real-integration.yml` runs only the new SCM API/issuer/consumer cases plus an isolated PostgreSQL 16.14 + verified HTTPS integration. It uses original 004/012 and new 034 SQL, real DeviceProof, replay rejection, concurrent idempotent publication, immutable SQL grants, live SERVICE consumption and persistent revocation. Its temporary TLS material and database are test fixtures only. It does not certify the native Windows peer, real Electron process identity, Windows ACL/DPAPI custody or installer recovery. Publication of the workflow is not evidence that it executed successfully; inspect its exact-HEAD result.

## Certification still pending

- Real Central database migration/publication and custody of the independent signing root.
- Authenticated operator/installer provisioning of matching candidate, signed policy, device credential and root on the target SERVICE identity.
- Native SERVICE-to-Electron interoperability, revocation/restart and recovery on the actual Windows installation.
- Explicit root/candidate transition and validity renewal before attempting those operations.

SCM commercial remains disabled. PR #127 stays Draft and must not be merged by this task.

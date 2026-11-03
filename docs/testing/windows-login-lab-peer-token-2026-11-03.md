# Windows login lab: physical peer-token correction

Scope: native Windows SCM channel only; no production enablement, DPAPI
rotation, trust replacement, service identity change or filesystem ACL repair.

Observed on Windows Server 2022, source 220a8460:
- Isolated runtime 80d728a3cae445f9a0be8e8aa7b022f9 dependency probe passed.
- Service and Desktop operator DPAPI enrollments: one actual test passed each.
- First physical Node round failed with WINDOWS_NATIVE_PIPE_REJECTED.
- Real SCM token could not OpenProcess on the interactive operator, requesting
  0x101000 or even 0x1000: both returned Win32 error 5. Runner hash/SDDL restored.
- Failed report remains in the attempt's physical-execution-d2c1db6baeb84ca1ab90c07839e711e5.
  No physical approval is attributed to that attempt.

The server now queries the identity token attached to the actual connected
named pipe, with OpenThreadToken(TOKEN_QUERY), and always reverts before other
work. Failed reversion terminates the process. No peer process/token DACL is
expanded. A four-byte native version preface is consumed before impersonation;
it carries no credentials and does not authorize an operation. Missing or old
prefaces fail closed; both ends must use the same pinned addon.

SID, logon SID, session and repeated kernel PID checks remain mandatory.
Creation-time binding remains: SystemProcessInformation is read through a
dynamically resolved system API and its x64 layout is validated against the
caller's GetProcessTimes before accepting a peer's creation time. A missing
process, PID reuse or unsupported layout rejects the connection. The client
still checks SCM ownership, ancestry and service identity. Framing, MAC,
signed handoff, leases, replay protection and revocation remain in their owners.

Validation observed before commit:
- Native MSVC build passed using the existing Python 3.12.10.
- Kernel reader executable regression: 1 PASS, no skips; self and child
  creation times match GetProcessTimes, absent and exited peers reject.
- Existing addon smoke: Node PASS, Electron PASS; receipt under
  camacho-native-smoke-wFEBG1 in operator TEMP.
- The initial test harness compilation command had a quoting error; corrected
  to a scoped batch file. Failed temporary evidence was preserved.
- Physical G1/G2 on the corrected addon remains pending; smoke is not approval.

References:
- https://learn.microsoft.com/windows/win32/api/namedpipeapi/nf-namedpipeapi-impersonatenamedpipeclient
- https://learn.microsoft.com/windows/win32/api/winternl/nf-winternl-ntquerysysteminformation

## Continuation: actual transport and local human enrollment

The corrected Node Desktop physical test passed. The Service reached and passed
the two-operation, two-authenticated-connection and durable revocation-row
assertions, then failed its final socket count: 3 closed sockets versus an
incorrect expectation of 2. The third socket belongs to the deliberately rejected
signer-pin client; it never enters the authenticated handler. The regression now
requires both authenticated IDs to be closed AND exactly one additional rejected
connection. No production authorization behavior changes.

The failed combined attempt remains under runtime
9f8343ebef8e482fa2a63a7fd8ecad2a / physical-combined-ba1f5e50ded94d1d84c0dff88451688c.
It is not counted as a passing test run. The original runner was restored and
SCM stopped.

The owner explicitly authorized a local, isolated Central rather than any
productive VPS or domain. PostgreSQL 16.14 portable runs on loopback 55433 with
distinct SCRAM role credentials. Canonical 001–016 authentication migrations
were applied, with durable receipts under central-lab. The committed 006 body
was reconciled only after its 132 real four-role TLS/ACL assertions passed and
its checksum/state were checked under the canonical global advisory lock.
No licensing business data or payment integration was created.

The lab CA is restricted to camacho-pos.local and 127.0.0.1. It is installed only
in the operator's CurrentUser root store. Hosts contains only two new loopback
aliases; its prior bytes, SDDL and hashes are journaled in central-lab/tls.
No TLS verification bypass is used.

The first-human enrollment operator reuses canonical Argon2, durable ENROLL
challenges, real WebAuthn attestation/UV verification and the enrollment
transaction. It requires the actual elevated interactive Windows operator, an
empty dedicated lab database and a single-use capability. The temporary role
has no permission grants; its server-issued enrollment session remains PENDING,
and neither BUSINESS nor SSA is issued. The role/session are revoked after
actual enrollment. Existing accounts or partial custody are preserved for review.

Observed technical checks: verified TLS, page/CSP, browser-script syntax, no
capability embedded in the HTML, cross-origin denial, invalid capability denial,
unauthenticated completion denial, untrusted TLS rejection, and no fabricated
users/factors/sessions: 10 PASS. Strict TypeScript checking passed.
A real browser profile is open for the owner's first registration; no virtual
authenticator was used. Positive human registration remains pending.

Purpose-separated device/SSA/SAS/access key material was created only in the
private lab authority directory and signed/verified with the canonical owners.
Metadata explicitly marks LAB_ONLY/PREPRODUCTION, device possession pending,
human factor pending and no BUSINESS session. These artifacts are not productive
trust, a completed enrollment or a passing G2 certificate.

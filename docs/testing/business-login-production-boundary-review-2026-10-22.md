# BUSINESS login — production boundary review (2026-10-22)

**Scope:** `feat/android-commercial-runtime` after `9189eb82`. This is a code/contract review, **not** an approval for production deployment.

## Verified implementation boundary

- `apps/central-authority/src/main.ts` serves `GET /health`, `GET /v1/session-trust`, and `POST /v1/device-enrollment`. It does **not** expose BUSINESS password/MFA/code exchange/refresh/logout HTTP routes.
- `BusinessLoginCoordinator` composes the existing password + WebAuthn MFA flow and `BusinessSessionAuthority`, with an injected trusted attempt-control interface. An interface is not a durable, approved abuse-control implementation.
- `BusinessAccessPreparation` rejects production mode, requires local `127.0.0.1:55433` and an isolated `pos_business_session_test_<16 hex>` database. Its in-process WeakMap reference is non-serializable and must never become a bearer credential.
- `PostgresBusinessSessionRevocationTransaction` locks the authenticated BUSINESS session `FOR UPDATE`, revokes session and refresh rows, and appends `SESSION_REVOKED` on the same transaction client. A successful internal transaction does not establish a production-capable logout endpoint.
- `prepareSequence()` burns the internal preparation reference. A production logout cannot rely on reusing that consumed reference: it requires independently authenticated server-side state.
- The owner's Windows execution reported 88/88 physical BUSINESS tests, then 32/32 access-preparation tests (including five new logout cases), and 8/8 coordinator unit tests. These are independently scoped runs, not full production E2E. Existing PR #96 remains draft.

## Contracts and dependencies not approved

See `docs/testing/android-commercial-approval-proposal-2026-10-22.md` and `docs/testing/business-access-continuity-2026-10-20.md`. They explicitly mark DEV-003, SEC-004, D3, and DEC-025 candidates **not approved**.

1. **Central deployment / RP**: controlled HTTPS hostname, certificate, WebAuthn RP/origin, authoritative tenant/company/device enrollment, operator and trust-root chain.
2. **Native OAuth-style ceremony**: versioned client/redirect and one-use authorization code with PKCE S256 + state; durable code-owner and replay policy. No authorization-code server exists in `main.ts` today.
3. **Access binding**: approved JWT or alternative profile, issuer/audience/keys, confirmation of device possession, token hash binding into DeviceProof, live session/tenant status validation, claim provenance and revocation race policy. Neither SSA nor session UUID is an access token.
4. **Refresh and abuse**: transactionally rotated/hashed refresh-family and reuse handling; approved durable attempt limits and neutral error behavior. Candidate time windows are not defaults or an approved policy.
5. **Native UI/channel**: approved Electron external-browser callback and Android App Link, WebView origin/IPC allowlists and device-bound custody. No WebAuthn ceremony from `file://`, no wide JavaScript bridge.
6. **Local permission issuance**: server-authoritative authorization projection and operational signing keys are still needed to complete `TrustedSessionAssertionIssuance`.

## Implementation order after decisions

1. Record explicit approvals and resolve true deployment and ownership; keep the current fail-closed production gate.
2. Implement the canonical one-use code issuance/consumption and validated client callback **with independent security tests**, not a second user store.
3. Implement device-bound access proof, refresh rotation/revocation and durable rate limiting within the existing identity ownership.
4. Bind validated human session + device context to existing SSA issuer and local-service authorizer; run negative RLS/replay/race tests.
5. Wire the unchanged Electron and Android UI through authenticated native boundaries; only then run end-to-end operational tests.

**Forbidden shortcuts:** switching `ISOLATED_VALIDATION` to production, hardcoding RP/domain/credentials, granting `BYPASSRLS` to `pos_platform_app`, serializing WeakMap references, using SSA/refresh as access, disabling WebView/Electron security, fabricating a central server or device registration, or treating successful isolated tests as a launch approval.

No schema, production config, UI, Android hardware, or central service was changed by this review.

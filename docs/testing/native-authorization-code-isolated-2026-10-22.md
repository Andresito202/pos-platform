# Native code consumption — isolated PostgreSQL implementation

**Not production authorization**. `IsolatedPostgresNativeCodeConsumer` checks an allowlisted localhost:55433 pool and a database matching `pos_native_code_test_<16 lowercase hex>`. Its storage schema exists only in `tools/target-migrations/sql/postgres/native-authorization-code-isolated-fixture.sql`, outside migration manifests.

- Code is looked up by SHA-256 digest, never persisted in plaintext.
- `SELECT ... FOR UPDATE` serializes concurrent exchange attempts against a code.
- A matching live, unconsumed row is consumed even on mismatched PKCE, state or client/redirect. Expired/consumed codes are rejected.
- Commit happens **before** any trusted in-process binding resolver runs. Resolver failure cannot undo a consumed code.
- No automatic DDL, no production access, no refresh issuance, no HTTP listener.
- This fixture uses an opaque binding ID to exercise the protocol; an approved binding lifecycle, durable attempt control, code issuance, event audit and identity owner are still mandatory before real deployment.

The canonical production table, D3 parameters, device confirmation and code issuance procedure **remain unapproved**. This fixture is deliberately not a production migration.

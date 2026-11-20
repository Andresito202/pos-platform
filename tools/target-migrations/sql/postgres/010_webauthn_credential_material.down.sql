-- Retained WebAuthn public-key/counter metadata is security evidence.
-- Never perform destructive down migration while any records remain.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM identity.webauthn_credential_material LIMIT 1) THEN
    RAISE EXCEPTION '010 rollback refused: WebAuthn credential material exists';
  END IF;
END
$$;

DROP TABLE identity.webauthn_credential_material;
DROP FUNCTION identity.webauthn_credential_material_guard();

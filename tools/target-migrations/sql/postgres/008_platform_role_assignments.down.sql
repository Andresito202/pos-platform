DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "authorization".platform_role_assignments) THEN
    RAISE EXCEPTION '008 down refused: platform role assignments exist; revoke and export audit evidence before rollback';
  END IF;
END
$$;

DROP TABLE "authorization".platform_role_assignments;
DROP INDEX "authorization".authorization_roles_id_scope_uq;

-- Revocation history cannot be removed by an automated rollback.
DO $$ BEGIN RAISE EXCEPTION 'SCM_CHECKPOINT_HISTORY_REQUIRES_RECONCILIATION'; END $$;

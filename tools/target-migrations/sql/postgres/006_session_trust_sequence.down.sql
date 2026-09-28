-- Reversión de 006. Retirar la secuencia deja de poder emitir sesión: el login
-- sigue autenticando, pero sin sobres firmados que activar en el POS.
REVOKE USAGE ON SEQUENCE identity.session_trust_sequence FROM pos_platform_app;
DROP SEQUENCE IF EXISTS identity.session_trust_sequence;

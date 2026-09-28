-- 006 — secuencia monótona de emisión de sesión (`DEC-011` «Replay y
-- versionado», `DEC-012`; `DEC-026` §13.10).
--
-- La SSA y el SAS llevan `sequence`, y el POS local sólo acepta una
-- estrictamente mayor que la última aceptada para el mismo binding. `DEC-011`
-- deja la monotonía a cargo del emisor: esta secuencia es esa garantía. Una
-- sola, global: si crece para todos, crece para cada binding.
--
-- Sin tablas ni datos: nada que la 001 tuviera se modifica.
CREATE SEQUENCE identity.session_trust_sequence
  AS bigint
  START WITH 1
  INCREMENT BY 1
  NO CYCLE;

GRANT USAGE ON SEQUENCE identity.session_trust_sequence TO pos_platform_app;

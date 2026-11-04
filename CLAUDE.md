# Claude Code — Camacho POS Colombia

Lee primero `AGENTS.md`; sus restricciones de gobernanza, seguridad, arquitectura y rama activa son obligatorias.

Para tareas de diseño del POS (UI/UX, interacción, componentes, motion, accesibilidad visual) activa la skill local `.claude/skills/emil-design-eng/SKILL.md` (`emil-design-eng`). La misma versión se mantiene en `.agents/skills/emil-design-eng/SKILL.md` para otros agentes.

Utiliza la skill para evaluar decisiones, no para imponer efectos decorativos. Respeta el sistema visual B, el acceso por permisos efectivos, las operaciones de caja, el modo offline y `prefers-reduced-motion`. Si una recomendación contradice `AGENTS.md`, un contrato, una prueba o una política de seguridad, prevalecen las restricciones del POS.

Para verificar copias y procedencia: `node tools/design/check-emil-skill.mjs`. Para referencias y límites: `docs/design/agent-skill-emil.md`.

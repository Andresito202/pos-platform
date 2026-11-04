# Instrucciones de Copilot — Camacho POS

Antes de editar código, leer `AGENTS.md` y respetar su regla de una sola línea de desarrollo.

Para diseño de interfaces, componentes, microinteracciones, feedback visual, accesibilidad de movimiento y animaciones, utilizar la skill instalada `.agents/skills/emil-design-eng/SKILL.md` (`emil-design-eng`). Ver `docs/design/agent-skill-emil.md` para procedencia y activación.

No añadir movimiento por defecto. Conservar Commercial Precision B, soporte táctil y de teclado, foco, `prefers-reduced-motion`, contratos backend, seguridad, permisos y flujos offline. Las modificaciones de UI deben acompañarse de verificación visual y tests focales; no inventar sesiones o datos para simular funcionalidad.

Control de integridad de instalación: `node tools/design/check-emil-skill.mjs`.

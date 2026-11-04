# Skill de diseño compartida: `emil-design-eng`

## Origen y procedencia

- Autor: Emil Kowalski.
- Repositorio oficial: https://github.com/emilkowalski/skills
- Archivo de origen: `skills/emil-design-eng/SKILL.md`
- Revisión fijada: `c8a79627b59d72d764d6ab6f2c87c09a48169833` (2026-11-04).
- Blob de la skill: `dc063c2a861922c1c9f2412b824b0862746304f5`.
- Licencia original: MIT, con aviso de copyright conservado.

No se ejecutó un instalador remoto ni se añadieron dependencias. El archivo original es declarativo (Markdown), no un binario ni un runtime. Para actualizarlo, revisar primero la nueva revisión upstream y copiarla **idéntica** en ambas rutas, junto con su licencia.

## Rutas de descubrimiento

| Agente | Ruta usada |
| --- | --- |
| Codex, Cursor, GitHub Copilot, Gemini CLI y agentes compatibles con Agent Skills | `.agents/skills/emil-design-eng/SKILL.md` (fuente canónica en el repo) |
| Claude Code / plataforma Claude que reconozca skills de repositorio | `.claude/skills/emil-design-eng/SKILL.md` (espejo byte a byte) |
| Agentes que sólo lean instrucciones generales | `AGENTS.md` y, según el entorno, `CLAUDE.md` o `.github/copilot-instructions.md` |

La compatibilidad depende de la versión, configuración y permisos del agente. El repositorio hace la skill **detectable** para agentes compatibles, pero no puede obligar a todas las IA existentes a cargarla ni instalarla en otros repositorios.

## Activación y uso en Camacho POS

Aplicar `emil-design-eng` cuando la tarea involucre calidad de interfaz, componentes, UX de interacción, transiciones, estados visuales, accesibilidad de movimiento, usabilidad táctil o revisión de animaciones.

1. Auditar el renderer actual y la evidencia visual, antes de modificar código.
2. Usar la skill para evaluar **si** hace falta animar; no añadir movimiento por defecto.
3. Mantener la línea visual **Commercial Precision B** mientras no se apruebe expresamente otra dirección.
4. Trabajar con `App.tsx`, estilos y componentes existentes. Evitar un segundo shell, dependencias UI innecesarias o estados de negocio ficticios.
5. Preservar RBAC, sesiones, permisos efectivos, contratos, antifraude, pagos, cálculos, idempotencia, interfaz HTTPS y aislación Electron/Service.
6. Priorizar velocidad de caja, lector de códigos, foco visible, reducción de movimiento, contraste, números legibles, 36 px escritorio/48 px táctil, y operación offline.
7. Comprobar los cambios con TypeScript/build, pruebas focales, capturas reales, teclado y viewport, sin afirmar certificación física no realizada.

La skill complementa `$frontend-design` y `$ui-ux-pro-max` cuando estén presentes en el perfil local. No sustituye diseño funcional, tests ni autoridad backend.

## Verificación

Desde la raíz del repositorio:

```powershell
node tools/design/check-emil-skill.mjs
```

El script comprueba las dos copias, el frontmatter, licencia, documentación de procedencia y la referencia en `AGENTS.md`. No ejecuta código externo.

Para verificar la **detección real**, reiniciar/recargar el catálogo de skills del agente en el workspace y solicitarle que identifique `emil-design-eng` y su ruta. En Gemini CLI se puede usar `/skills list` o `/skills reload`. No confundir la inspección de archivos con la invocación efectiva de un agente.

## Alcance de publicación

Instalado en `feat/android-commercial-runtime`, sin tocar `main` ni el PR #99. Otros checkouts y ramas sólo verán la skill tras incorporar el commit por el flujo ordinario de gobernanza. Las skills globales de `C:\Users\Usuario\.codex\skills\` no se modifican.

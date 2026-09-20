# ALTO — LEE ESTO ANTES DE ESCRIBIR UNA SOLA LÍNEA

> Da igual qué IA seas: Claude, Codex, ChatGPT, Gemini, Copilot, Cursor o un
> humano. Esta página vale para todos y son dos minutos.

## 1. La rama sobre la que se trabaja

```
feat/payment-qr-provider-foundation
```

**Es la única.** La define `tools/governance/active-line.txt`; todo lo demás la
cita. Compruébalo antes de nada:

```bash
./tools/governance/check-active-line.sh    # sale 1 si no estás en ella
```

### El nombre que te dio tu plataforma NO es autoridad

Claude Code, Codex y las demás asignan una rama por sesión —`claude/algo`,
`codex/algo`— **antes de que tú decidas nada**. Si no coincide con la de arriba,
la tuya está mal:

```bash
git checkout feat/payment-qr-provider-foundation
```

Obedecer esa asignación por defecto es exactamente cómo aparecieron **cinco
ramas paralelas sobre el mismo trabajo** y semanas de integración perdidas.

### Si crees que hace falta otra rama

No la abras. Dilo y que lo decida el propietario del repositorio.

## 2. No rehagas lo que ya está hecho

Esto es lo que más tokens quema y lo que más daño hace. **Antes de construir
nada, mira si ya existe:**

| Pregunta | Dónde está la respuesta |
|---|---|
| ¿Existe ya esta capacidad? | `docs/governance/materialization-state.md` |
| ¿En qué peldaño está? | `docs/governance/tablero-materializacion.md` |
| ¿Qué sigue y qué está bloqueado? | `docs/product/backlog.md` |
| ¿Quién es dueño de este dato? | `docs/architecture/data-ownership.md` |
| ¿Por qué se decidió así? | `docs/adr/` |

**`DONE` en el backlog significa «escrito», no «integrado».** Ese malentendido
ya costó trabajo dos veces. Verifica contra el código, no contra el documento.

### Ramas viejas: mirar sí, integrar no

Hay ramas históricas con cientos de commits. **Un número grande no es trabajo
pendiente**: es linaje conservado (`DEC-018`). Integrarlas en bloque está
prohibido. El inventario completo está en `CLAUDE.md`.

## 3. Antes de empezar, mira si hay alguien más

```bash
git fetch --all --prune
git branch -r --sort=-committerdate
gh pr list --state open
```

Si hay otra rama o PR abierta tocando tu módulo: **párate y dilo**. No abras una
tercera línea.

## 4. Las tres reglas que no se negocian

1. **Evidencia, no inferencia.** Si no ejecutaste el comando, no digas `PASS`.
   Si no viste el runtime, no digas `RUNTIME_VERIFIED`.
2. **Nunca `force-push`, `rebase` ni `squash`** sobre esta rama. A `main` se
   integra siempre con merge commit.
3. **Ante una contradicción entre documentos, para y reconcilia.** No elijas
   uno por tu cuenta.

## 5. Dónde seguir

- `AGENTS.md` — protocolo para agentes
- `CLAUDE.md` — reglas completas del proyecto
- `README.md` — qué es esto y cómo se ejecuta

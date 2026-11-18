# Gobernanza del repositorio

## Propósito

Este documento es la fuente normativa para ramas, pull requests, integración en `main`, evidencia remota y cierre de trabajo en POS Platform.

No sustituye el backlog ni las decisiones de arquitectura. Su función es impedir cambios huérfanos, merges ambiguos, estados Git inventados y ramas abiertas sin objetivo vigente.

## Línea de ejecución vigente — 2026-11-09

Por orden del propietario de unificar el trabajo, se continúa únicamente `cursor/commercial-design-review-0d11`, rama existente cuya base inspeccionada es `6a02c858`. El destino de entrega sigue siendo main. No se crea una rama de consolidación adicional ni se trabaja en paralelo sobre sus predecesoras.

El cambio de dirección no autoriza merges sin revisar ni acredita producción. El retiro de ramas requiere comprobar contenido exclusivo y dependencias de PR; el inventario actual está al inicio del backlog. Las referencias históricas a otras líneas activas conservan solamente su alcance fechado.

## Rama canónica

`main` es la única rama canónica del producto.

Una rama de trabajo no se convierte en fuente de verdad por existir, tener CI verde o contener más commits. Su contenido solo pasa a ser canónico después de una integración aprobada y verificada en `main`.

## Protección de `main`

El repositorio es privado. En el plan GitHub vigente, la protección preventiva de ramas/rulesets para este repositorio no está disponible. GitHub reporta `main` con `protected: false` y sin required status checks.

Por tanto:

- `BRANCH_PROTECTION_NATIVE = NOT_AVAILABLE_ON_CURRENT_PRIVATE_REPOSITORY_PLAN`;
- no se presenta un workflow como sustituto preventivo de branch protection;
- no se hará público el repositorio únicamente para obtener esa función;
- cuando el plan permita protección nativa, deberá configurarse sin romper la política de merge normal descrita aquí.

## Control compensatorio vigente

`.github/workflows/target-foundation-validation.yml` se ejecuta en:

- `pull_request` hacia `main`;
- `push` a `main`;
- `workflow_dispatch`.

El job `Main push governance` es detectivo y aplica únicamente a pushes sobre `main`. Valida **todo el rango de primer padre introducido por el push**, desde `github.event.before` hasta `github.sha`. Para cada commit de esa cadena exige que:

1. el rango sea fast-forward y continuo;
2. el commit tenga exactamente dos padres;
3. haya sido creado por GitHub como merge commit;
4. esté asociado a una pull request fusionada;
5. sea exactamente el `merge_commit_sha` de esa PR;
6. tenga `main` como base.

Un direct push aislado o incluido junto a otro merge, squash merge, rebase merge, rango no demostrable o cadena discontinua debe producir `FAIL` en este control. El fallo es evidencia de una violación ya ocurrida; no constituye prevención nativa.

La primera validación real de este control ocurrió después de integrar la PR #5: run `32933559784` sobre merge commit `bfca119b27f9b4bf0a7b0541708161a2beb2833d`, con `Main push governance = SUCCESS` y workflow completo `SUCCESS`.

## Método de integración autorizado

La política del proyecto permite únicamente:

`branch -> pull request -> revisión -> CI commit-scoped -> autorización -> merge normal -> verificación post-merge`

No se usa squash ni rebase para integrar a `main` mientras esta política esté vigente.

### Política permanente de "revisión" en proyecto de un solo desarrollador

Este repositorio tiene un único desarrollador y dueño autorizado a escribir en él:
Wilson Andrés Camacho Culma. No existe ni existirá otro humano autorizado a
aprobar PRs mientras esta condición se mantenga. Por tanto, la etapa `revisión`
del flujo de integración de la sección anterior se satisface con la revisión
del propio autor del diff completo mergeado, documentada con su nombre y fecha
en el registro del RT/PR correspondiente (ver docs/product/backlog.md).

Esto es política explícita y permanente, no un pendiente caso por caso: no se
requiere abrir ni volver a abrir un punto de "revisión humana pendiente" por
esta razón en ningún RT futuro, mientras el proyecto siga siendo de un solo
desarrollador. Un review automatizado (bot) nunca sustituye esta revisión de
autor; solo la documenta como evidencia adicional, no como reemplazo.

Si en el futuro se incorpora otro colaborador autorizado a mergear, esta
política queda revocada desde ese momento y la revisión pasa a requerir un
segundo humano — eso debe registrarse como decisión versionada nueva, no
inferirse.

### Gate pre-merge obligatorio

Inmediatamente antes de cada merge se verifica:

1. `main` conserva el SHA esperado;
2. la PR sigue `OPEN`, `READY` y `MERGEABLE`;
3. el HEAD de la PR es exactamente el SHA revisado;
4. la rama está `0 behind` respecto del baseline aplicable o la divergencia está explícitamente resuelta;
5. los workflows aplicables al HEAD están `COMPLETED / SUCCESS`;
6. no existen review threads bloqueantes sin resolver;
7. no se incorporan archivos, migrations, runtime o alcance no autorizado;
8. existe autorización de integración conforme al flujo vigente;
9. el merge utiliza `expected_head_sha` y método `merge`.

Un CI histórico sobre otro SHA no satisface este gate.

### Verificación post-merge obligatoria

Después del merge se verifica:

1. PR `CLOSED / MERGED`;
2. `main` apunta al merge commit esperado;
3. los padres son el `main` anterior y el HEAD revisado;
4. el árbol integrado corresponde al contenido autorizado;
5. el workflow de `push` sobre el nuevo `main` se ejecuta y sus jobs aplicables terminan `SUCCESS`;
6. no aparece un delta inesperado;
7. se actualiza la documentación operacional afectada en el mismo cambio coherente o en la transición inmediatamente controlada cuando el merge altera el estado canónico.

## Ciclo de vida de ramas

Cada rama debe tener uno de estos estados:

- `ACTIVE`: existe trabajo vigente, delimitado y trazable por backlog/PR;
- `BLOCKED`: conserva trabajo todavía válido, pero el impedimento y la condición de desbloqueo están documentados;
- `INTEGRATED`: todo su contenido necesario ya está en `main`; debe eliminarse cuando la capacidad operativa disponible permita hacerlo;
- `HISTORICAL_WIP`: conserva evidencia que no debe integrarse y tiene una condición explícita de retiro;
- `ABANDONED`: objetivo cancelado; debe cerrarse/eliminarse sin fusionar.

No se crea una rama nueva si una rama activa ya posee el mismo objetivo. No se deja una rama `ACTIVE` sin PR o sin un objetivo de backlog verificable.

Una rama `INTEGRATED` no se reutiliza para trabajo nuevo.

## Estado de ramas persistentes

El inventario canónico y vigente de ramas persistentes se mantiene en `docs/product/backlog.md`, junto con su estado y decisión de retiro. Este documento conserva únicamente las reglas de ciclo de vida para evitar duplicar un snapshot que pueda quedar obsoleto.

Las ramas temporales usadas para una reconciliación o implementación pasan a `INTEGRATED` cuando su PR se fusiona y no se reutilizan. Si GitHub conserva el ref después del merge, la existencia física del ref no convierte la rama de nuevo en `ACTIVE`.

Las ramas históricas integradas deben eliminarse mediante mantenimiento separado cuando exista una operación de borrado de refs autorizada y disponible. No se simula su eliminación mediante force-push o movimiento artificial del ref.

## Evidencia remota y estado local

GitHub remoto puede demostrar:

- ramas y SHAs remotos;
- commits y árboles;
- PRs, reviews y threads;
- workflows, jobs y artifacts;
- diferencias entre refs;
- configuración remota que el API exponga.

GitHub remoto no demuestra el estado actual de un working tree local. Sin verificación local expresa se usa:

`NOT_EVALUATED / REQUIRES_LOCAL_VERIFICATION`

para:

- `git status` local;
- staged/unstaged;
- upstream local;
- Docker local;
- PostgreSQL local;
- procesos locales;
- pruebas ejecutadas exclusivamente en el equipo del desarrollador.

Nunca se convierte un snapshot histórico de estado local en un hecho presente.

## Branch protection futura

Cuando el plan permita protección preventiva, la configuración objetivo debe incluir como mínimo:

- require pull request before merging;
- required status checks para los jobs canónicos aplicables;
- require conversation resolution;
- no force pushes;
- no branch deletion de `main`;
- no bypass ordinario.

No se habilita `Require linear history` mientras la política oficial use merge commits normales. `Require signed commits` solo se habilitará después de definir y probar una estrategia de firma compatible con commits humanos y automatizados.

## Regla de consistencia

Si README, backlog, PR, workflow, ADR o documento de avance presentan estados incompatibles, no se elige uno arbitrariamente. Se detiene la transición afectada, se identifica la fuente normativa y se reconcilia el conjunto antes de continuar.

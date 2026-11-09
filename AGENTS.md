# AGENTS.md — Camacho POS Colombia

## Regla principal: una sola línea de desarrollo

Este repositorio se desarrolla sobre **una única línea activa**. La existencia de una idea técnicamente interesante no autoriza a abrir otra línea.

### Línea activa vigente

- Rama de trabajo activa: verificar la decisión vigente del propietario y el tablero antes de modificar código; no deducirla de un documento histórico.
- Rama canónica del producto: `main`
- El trabajo nuevo debe continuar sobre la rama activa vigente, salvo una decisión explícita de gobernanza que cambie esa línea.

## Prohibido crear trabajo paralelo por iniciativa propia

Una IA, agente o colaborador **NO DEBE**:

- abrir otra rama porque considere que su enfoque es mejor;
- crear un segundo diseño para el mismo problema;
- rehacer una capacidad ya implementada sin demostrar primero un defecto;
- iniciar una arquitectura alternativa sin ADR/decisión explícita;
- hacer cherry-pick o merge de ramas históricas completas para “aprovechar trabajo”;
- continuar trabajo desde una rama histórica que ya no es la línea activa;
- inventar backlog, gates, tablas, estados, migrations o módulos paralelos para resolver una necesidad que ya tiene owner y línea de implementación;
- interpretar una contradicción documental como permiso para escoger una opción arbitraria.

**Primero se continúa lo construido. Después se corrige lo demostrado. Sólo se abre una nueva línea si la gobernanza lo autoriza expresamente.**

## Protocolo obligatorio antes de tocar código

1. Leer `README.md`.
2. Leer este `AGENTS.md`.
3. Leer `docs/governance/repository-governance.md`.
4. Leer `docs/governance/tablero-materializacion.md`.
5. Leer `docs/product/backlog.md`.
6. Identificar la rama activa y el objetivo vigente.
7. Auditar lo que ya existe antes de diseñar algo nuevo.
8. Buscar ADR, contrato y owner existentes antes de proponer una nueva solución.
9. Si hay contradicción entre fuentes normativas, **detener la implementación y reconciliar primero**.
10. Declarar el alcance exacto antes de escribir.

## Regla de continuidad

El proyecto prioriza **evolución incremental sobre el árbol existente**. Una solución nueva debe demostrar por qué la existente es incorrecta, insuficiente o incompatible con un contrato vigente.

No se acepta como justificación: “es una arquitectura más limpia”, “yo lo haría diferente”, “conviene rehacerlo” o “es mejor crear otro módulo”. La justificación debe ser evidencia concreta: contrato incumplido, defecto reproducible, incompatibilidad arquitectónica, requisito nuevo autorizado o gate fallido.

## Trabajo terminado y trabajo pendiente

No confundir:

- `DOCUMENTED`: existe documentación;
- `IMPLEMENTED`: existe código;
- `TESTED`: existe ejecución de prueba observada;
- `RUNTIME_VERIFIED`: el runtime productivo instancia la capacidad;
- `CALLER_REACHABLE`: un llamador externo cruza el transporte real y llega al handler/efecto real;
- `END_TO_END`: existe superficie de producto y cadena completa;
- `PRODUCTION`: evidencia del entorno productivo objetivo.

CI verde, existencia de un archivo o existencia de una prueba no permiten saltar peldaños.

## Qué NO tocar sin una razón demostrada

Una capacidad ya integrada y cerrada no se modifica “para mejorarla” sin:

- evidencia de defecto o requisito nuevo;
- identificación del contrato afectado;
- impacto sobre tests/gates;
- autorización para ese alcance.

Los componentes críticos —contratos, migrations cerradas, reglas de ownership, single-writer local, idempotencia, append-only y seguridad fail-closed— se tratan como superficies de compatibilidad.

## Git y publicación

- No `reset --hard`.
- No `rebase` destructivo.
- No `force-push`.
- No mover refs para simular borrado.
- No eliminar evidencia histórica sin reconciliación.
- No integrar a `main` sin PR, CI del HEAD exacto, autorización y verificación post-merge.
- No declarar `PASS`, `TESTED` o `VERIFIED` por inferencia.

## Regla para cualquier otra IA/agente

Si el agente no puede determinar cuál es la línea activa, **no debe crear una nueva**. Debe detenerse y revisar la fuente normativa correspondiente.

## Principio final

> **Una sola línea. Un solo objetivo activo. Una sola fuente de verdad por tipo de decisión. Se construye sobre lo existente; no se dispersa el proyecto.**

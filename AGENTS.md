# AGENTS.md — Camacho POS Colombia

## Regla principal: una sola línea de desarrollo

Este repositorio se desarrolla sobre **una única línea activa**. La existencia de una idea técnicamente interesante no autoriza a abrir otra línea.

### Línea activa vigente — decisión del propietario 2026-11-09

- Única rama activa: `cursor/commercial-design-review-0d11`. Se continúa esta rama existente; no crear, renombrar ni abrir otra para la consolidación.
- Rama canónica de entrega: `main`, mediante el flujo de PR y verificación existente. No desarrollar en paralelo en main.
- Base inspeccionada: `6a02c858a38a18d801532706eac34e440befea72`. Contiene como ancestros Windows P0 `f277416f`, login local `7f44c05d` e integración `e31e008a`; restaura SalePanel, que en e31e008a contiene únicamente FULL_CONTENT_WILL_BE_INSERTED.
- Esta elección conserva el historial y no certifica runtime, licencias ni login BUSINESS. El nombre histórico de la rama no impone el launcher DesignReview como producto.
- Dirección: Andrés define alcance y decisiones de producto; el asistente coordina diagnóstico y diseño con él. Otras IA ejecutan tareas delimitadas en esta misma línea, sin variantes propias ni escrituras concurrentes sobre los mismos archivos.
- Las órdenes anteriores que señalan otra rama activa quedan sustituidas para trabajo futuro por esta decisión; su evidencia técnica y controles de seguridad conservan su alcance.
- Objetivo único: consolidar el POS existente, conectar login y pantallas a servicios reales, corregir lo defectuoso y retirar lo redundante tras comprobar cobertura. No rehacer el POS.

### Contrato de consolidación y retiro

1. Trabajar sobre `apps/pos-desktop`, su renderer y `apps/pos-local-service` existentes. No crear otro shell, otro App ni pantallas desconectadas.
2. Seguir cada operación UI → hook → preload/canal → handler → caso de uso → persistencia. Un botón o captura no acredita el flujo.
3. No sustituir componentes por marcadores, contenido prometido o formularios sin operación conectada.
4. No presentar local-operator-development-bridge como autorización BUSINESS; no trasladar semillas, claves o provisión DesignReview a producción.
5. Revisar cambios exclusivos de Android/balanza/QR por capacidad y dependencias. La divergencia Git no demuestra que sean inútiles ni que deban integrarse completos.
6. Cada frente debe terminar con decisión verificable: incorporar y probar; corregir y probar; o retirar por duplicación, sustitución o cancelación demostrada. No mantener variantes activas indefinidamente.
7. Antes de borrar una rama/carpeta, comprobar trabajo exclusivo, PR dependientes y datos locales. Borrar refs no equivale a borrar evidencia del historial. No borrar main.
8. No afirmar que GitHub identifica la ventana del PC o sus cambios sin publicar. El working tree y dist de Windows siguen pendientes de inspección.
9. El diseño se realiza sobre los componentes conectados después de fijar su identidad y capacidades. No abrir una maqueta como segunda aplicación.


## Decisión obligatoria de cierre de certificación — 2026-10-30

**LEER ANTES DE PROPONER CUALQUIER TRABAJO DE CERTIFICACIÓN:** [decisión vinculante](docs/governance/decision-free-certification-closure-2026-10-30.md).

- **CERRADO:** evaluación de certificados gratuitos de terceros, MSIX/Store, firma pública y dependencia de GitHub Actions. No reabrir el tema salvo orden expresa del propietario.
- **APROBADO EN SU ALCANCE:** certificación técnica local gratuita de 10 controles sobre HEAD histórico `1efddb4a`, y gate aislado de SQLite/Central/Postgres/RLS/enrolamiento sobre `72baef5e`; conservar evidencia y alcance exacto.
- **NO ACREDITADO:** instalación SCM (servicio ausente), interoperabilidad real entre identidades, login humano, emisión comercial completa y hardware. Estos son **pendientes de materialización del producto**, no de firma ni certificación externa.
- **PRIORIDAD:** corregir y conectar código funcional real, ejecutar pruebas locales relevantes y dejar las pruebas humanas/PC para cuando sean indispensables. Prohibido debilitar `SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN` para simular progreso.
- No modificar, reducir ni eliminar funcionalidad comercial por requisitos de una entidad certificadora; mantener seguridad fail-closed.

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

## Regla de continuidad para agentes

Cada agente debe tratar este archivo como una restricción de continuidad del proyecto. Antes de ejecutar una tarea debe auditar la línea activa y continuar desde el estado existente. Si detecta una solución alternativa, debe documentarla como hallazgo y no implementarla en paralelo.

## Regla para cualquier otra IA/agente

Si el agente no puede determinar cuál es la línea activa, **no debe crear una nueva**. Debe detenerse y revisar la fuente normativa correspondiente.

## Principio final

> **Una sola línea. Un solo objetivo activo. Una sola fuente de verdad por tipo de decisión. Se construye sobre lo existente; no se dispersa el proyecto.**

## Guía técnica y herramientas reutilizables

- Monolito modular, TypeScript estricto, pnpm workspaces y Nx; owners en `docs/architecture/module-map.md` y `data-ownership.md`.
- Electron + React + Vite no acceden directamente a la base de datos. POS Local Service es el único writer SQLite/WAL.
- Tenant, empresa y sucursal se derivan del contexto confiable; los IDs del cliente no conceden autoridad.
- Ventas autorizadas local-first no dependen de Internet. Conservar idempotencia, causalidad, append-only y conflictos explícitos; no usar last-write-wins genérico.
- Providers y hardware se integran mediante adapters, sin redefinir el dominio.
- Consultar scripts reales de `package.json`; no inventar comandos. Central Sync usa `central-sync:gate` en `@pos-platform/target-migrations`.
- Las guías existentes se conservan en `.agents/skills/` y el procedimiento en `.agents/commands/pipeline.md`. Su reubicación no amplía el alcance autorizado ni altera el código del POS.

## Pipeline de trabajo

1. AUDIT: identificar defecto, contrato, owner y solución existente.
2. PLAN: delimitar archivos, riesgos y evidencia necesaria.
3. BUILD: modificar sólo el alcance autorizado sobre lo construido.
4. TEST: ejecutar validaciones aplicables y conservar salidas reales, incluidos fallos y omitidas.
5. REVIEW: revisar diff, permisos, errores, regresiones y ausencia de duplicación.
6. EVIDENCE: registrar SHA, entorno y nivel realmente observado.
7. SHIP: publicar en la misma línea; integrar a main sólo mediante el flujo de gobernanza vigente.

## Coordinación con Grok y otras IA — 2026-11-10

- Andrés decide cuándo delegar. La primera tarea de evaluación de una IA será de lectura sobre un SHA concreto: diagnóstico con archivo/línea, reproducción y límites de acceso; sin ramas, commits ni rediseño propio.
- El asistente coordinador verifica el código y las pruebas, no acepta un resumen como evidencia de ejecución. Una propuesta sólo pasa a implementación con alcance y archivos delimitados por la dirección del proyecto.
- No trabajar simultáneamente en los mismos archivos ni declarar un cambio aplicado al PC cuando sólo existe en GitHub.
- Política solicitada de perfiles locales: CAJERO opera Caja; SUPERVISOR y ADMINISTRADOR revisan operaciones sin carrito ni permisos heredados de venta/cobro. La autorización BUSINESS firmada requiere su propia verificación; no sustituirla por una identidad local de desarrollo.

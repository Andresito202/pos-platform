# Gate SAST con CodeQL

## Alcance

Este documento define el control SAST materializado por `.github/workflows/codeql-sast.yml` para TECH-004.

El workflow analiza el JavaScript y TypeScript versionado del repositorio y conserva SARIF commit-scoped como artifact. No declara que exista runtime, que el producto sea seguro ni que los gates `SEC-G01..SEC-G10` estén cerrados.

## Ejecución

El análisis se ejecuta en:

- pull requests hacia `main`;
- pushes a `main`;
- ejecución manual;
- programación semanal como detección de nuevas reglas o modelos.

La fuente analizada es el HEAD real de la pull request o el SHA del evento. Checkout, inicialización y análisis usan acciones fijadas por SHA. El job dispone únicamente de `actions: read` y `contents: read`.

Lenguaje: `javascript-typescript`.

Query suite: `security-extended`.

Build mode: `none`, apropiado para JavaScript/TypeScript y sin inventar un build de aplicaciones todavía inexistentes.

## Política de aceptación

Un SHA solo satisface este slice cuando:

1. el workflow CodeQL aplicable termina `SUCCESS` y publica el artifact SARIF del SHA;
2. el SHA analizado coincide con el HEAD revisado;
3. no se suprime, excluye ni rebaja un finding para obtener verde sin justificación revisada;
4. el gate local bloquea cualquier resultado SARIF con nivel `error` o `security-severity >= 7.0`;
5. cualquier excepción propuesta identifica regla, ubicación, evidencia, responsable, vencimiento y condición de retiro, y requiere cambiar explícitamente la política revisada; no existe suppress automático;
6. las pruebas del evaluador SARIF pasan;
7. el workflow TARGET completo del mismo HEAD también permanece verde.

Las alertas medias y bajas se triagean por explotabilidad, frontera de confianza e impacto. El color del workflow no sustituye revisar el inventario de alertas.

## Limitaciones

Este gate no cubre por sí solo:

- vulnerabilidades conocidas de dependencias;
- secretos en historial Git;
- análisis dinámico;
- configuración de infraestructura;
- Electron, NestJS o POS Local Service todavía inexistentes;
- permisos, autenticación o autorización en ejecución;
- SBOM, provenance, firma o release;
- pruebas de penetración;
- garantía de ausencia de vulnerabilidades.

El repositorio privado no tiene code scanning habilitado: la primera ejecución analizó 48/48 TypeScript, 4/4 JavaScript y 2/2 workflows, pero GitHub rechazó la carga SARIF. El gate usa `upload: never`, evalúa SARIF localmente de forma fail-closed y lo conserva como artifact. Esto materializa SAST ejecutable, pero no habilita la interfaz de alertas de GitHub Code Scanning.


## Hardening posterior al primer PASS

El run #10 sobre `5ff292fbf0497748efce5d48d763990b0e0e4763` escaneó 48/48 TypeScript, 6/6 JavaScript y 2/2 GitHub Actions. Produjo un resultado SARIF no bloqueante `js/file-system-race` dentro del scanner de repository policy.

TECH-004 no lo suprime: el candidato de Bloque 1 reemplaza la secuencia path-check/path-read por apertura `O_NOFOLLOW`, `fstat` y lectura del mismo descriptor. El cambio requiere CodeQL y TARGET frescos antes de considerarse cerrado.

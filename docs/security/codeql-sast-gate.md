# Gate SAST con CodeQL

## Alcance

Este documento define el control SAST materializado por `.github/workflows/codeql-sast.yml` para TECH-004.

El workflow analiza el JavaScript y TypeScript versionado del repositorio. No declara que exista runtime, que el producto sea seguro ni que los gates `SEC-G01..SEC-G10` estén cerrados.

## Ejecución

El análisis se ejecuta en:

- pull requests hacia `main`;
- pushes a `main`;
- ejecución manual;
- programación semanal como detección de nuevas reglas o modelos.

La fuente analizada es el HEAD real de la pull request o el SHA del evento. Checkout, inicialización y análisis usan acciones fijadas por SHA. El job dispone únicamente de `actions: read`, `contents: read` y `security-events: write`.

Lenguaje: `javascript-typescript`.

Query suite: `security-extended`.

Build mode: `none`, apropiado para JavaScript/TypeScript y sin inventar un build de aplicaciones todavía inexistentes.

## Política de aceptación

Un SHA solo satisface este slice cuando:

1. el workflow CodeQL aplicable termina `SUCCESS`;
2. el SHA analizado coincide con el HEAD revisado;
3. no se suprime, excluye ni rebaja un finding para obtener verde sin justificación revisada;
4. cualquier alerta nueva de severidad alta o crítica bloquea el cierre hasta ser corregida o documentada como falso positivo reproducible;
5. una excepción identifica regla, ubicación, evidencia, responsable, vencimiento y condición de retiro;
6. el workflow TARGET completo del mismo HEAD también permanece verde.

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

Si GitHub no permite cargar resultados de code scanning por licencia o configuración del repositorio privado, el job debe fallar de forma visible. No se convierte en opcional ni se marca `PASS`; TECH-004 deberá documentar el bloqueo y seleccionar un SAST ejecutable equivalente mediante una decisión versionada.

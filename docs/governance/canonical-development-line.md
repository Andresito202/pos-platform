# Línea única de desarrollo canónico

## Estado y vigencia

**Registro histórico del 2026-09-16.** Este documento no designa la rama activa actual.

## Línea canónica

`main` es la única rama canónica del producto. La rama de implementación debe verificarse mediante la decisión actual del propietario, el PR vigente y Git.

El HEAD histórico auditado fue `bf39de720904f0b4aecf3541515c5b84cdb67f44`; los nombres del proveedor anterior se retiraron del árbol actual, pero siguen rastreables en el historial Git.

## Regla absoluta de desarrollo

Debe existir **una sola línea de implementación, un solo objetivo activo y una sola verdad técnica**.

No se debe:

1. crear otra rama para reimplementar una capacidad que ya existe en la línea activa;
2. abrir otra implementación de Payment/Cash/Sale/Inventory/Sync para comparar cuál es mejor;
3. copiar una solución de una rama histórica sin demostrar primero que aporta algo que no existe;
4. cambiar código estable sólo porque otra implementación parece más elegante;
5. retirar comentarios, documentación o código estable como limpieza estética sin demostrar su efecto;
6. declarar una implementación superada sin comparar su comportamiento y evidencia;
7. utilizar una rama histórica como segunda línea de desarrollo.

## Cómo se usa trabajo histórico

Las demás ramas, commits y PRs son **EVIDENCIA** hasta que se demuestre lo contrario.

El flujo obligatorio es:

`rama histórica -> identificar delta -> comprobar si ya existe -> verificar contrato -> integrar sólo valor único -> ejecutar pruebas -> registrar resultado`

Si el delta ya existe en la línea activa, **NO SE INTEGRA NI SE REIMPLEMENTA**.

Si el delta no existe pero es útil, se incorpora a la línea activa. La rama de origen deja de ser una línea de implementación y pasa a estado histórico/integrado.

## Regla de no regresión por cambio pequeño

Una capacidad marcada como `FROZEN_VERIFIED` no se modifica por preferencia, estilo, simplificación, refactor o supuesto beneficio.

Sólo puede reabrirse mediante nueva evidencia concreta, por ejemplo:

- fallo reproducible;
- contrato nuevo o corregido;
- decisión arquitectónica superior que la sustituya explícitamente;
- vulnerabilidad o defecto de seguridad confirmado;
- incompatibilidad de runtime demostrada;
- requisito funcional nuevo que haga insuficiente el comportamiento anterior.

Cuando se reabre, debe registrarse **qué evidencia invalida el estado anterior y qué pruebas deben volver a ejecutarse**.

Una opinión de cualquier agente no constituye por sí sola evidencia suficiente para reabrir una capacidad congelada.

## Orden de trabajo obligatorio

1. Leer esta política.
2. Leer la fuente normativa aplicable y las decisiones arquitectónicas relacionadas.
3. Confirmar el HEAD de la línea activa.
4. Diagnosticar antes de modificar.
5. Comparar contra la implementación existente.
6. Resolver contradicciones de arquitectura/contrato antes de escribir código.
7. Hacer el cambio mínimo justificable.
8. Ejecutar pruebas relevantes y registrar resultados reales.
9. Si una capacidad queda demostrada, registrarla como `FROZEN_VERIFIED`.
10. Continuar en la misma rama.

## Regla para ramas nuevas

Una rama nueva sólo puede existir si el objetivo no puede realizarse razonablemente sobre la línea activa por una razón documentada y temporal.

No se acepta como motivo:

- "quiero probar otra implementación";
- "esta rama es más limpia";
- "quiero hacerlo desde cero";
- "la otra rama tiene demasiados commits";
- "quiero comparar dos soluciones".

La comparación se hace contra commits o diffs históricos; no creando una segunda implementación.

## Estado de las ramas

Cada rama debe terminar en uno de estos estados:

- `ACTIVE`: sólo la línea canónica de implementación.
- `BLOCKED`: trabajo válido con bloqueo explícito.
- `INTEGRATED`: contenido útil ya incorporado.
- `HISTORICAL_WIP`: evidencia que no se integra.
- `ABANDONED`: objetivo cancelado.

Una rama `INTEGRATED`, `HISTORICAL_WIP` o `ABANDONED` no se reutiliza para trabajo nuevo.

## Principio de preservación

**Depurar Git no significa destruir historial.**

Antes de retirar una rama se debe determinar si contiene:

- código único todavía no integrado;
- una decisión arquitectónica todavía vigente;
- evidencia de una corrección;
- una prueba que no existe en la línea activa;
- una investigación que evita repetir trabajo.

Si contiene alguno de esos elementos, primero se conserva la evidencia apropiada en la línea canónica o en documentación. Sólo después se retira la rama cuando la operación de borrado esté disponible y autorizada.

## Regla de cierre

Cuando una rama termina su objetivo, no se vuelve a usar para el siguiente objetivo.

Cuando una decisión o capacidad queda verificada, se registra en `docs/governance/frozen-decisions-and-verified-behavior.md`.

El propósito es que ningún agente vuelva a tocar una solución estable por desconocer que ya fue ejecutada, probada y cerrada.

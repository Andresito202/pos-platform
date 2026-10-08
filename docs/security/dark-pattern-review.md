# Revisión de patrones oscuros — Camacho POS Colombia

**Fecha:** 2026-10-07  
**Superficie revisada:** renderer Electron/React y documentación comercial disponible en el repositorio  
**Estado:** REVISIÓN MATERIALIZADA — sin hallazgo crítico, sin certificación formal WCAG/dark-pattern

## 1. Criterios revisados

Se verificó que la superficie actual no introduzca deliberadamente:

- consentimiento por defecto o casillas premarcadas para una finalidad que requiera autorización;
- lenguaje engañoso o ambiguo para obtener una acción;
- cargos ocultos en una pantalla de contratación;
- cuenta o suscripción difícil de cancelar;
- temporizadores artificiales o falsa urgencia;
- opciones de rechazo ocultas frente a una aceptación prominente;
- bloqueo de una función mediante una acción no relacionada;
- afirmaciones comerciales no sustentadas.

## 2. Evidencia observada

La interfaz actual es una aplicación POS operativa, no una página de checkout o captación comercial. Las pantallas principales exponen acciones mediante controles nativos (`button`, `input`, `select`) y la navegación depende de permisos efectivos.

No se encontró una implementación de suscripción, newsletter, checkout comercial, countdown o mecanismo de falsa escasez en el renderer auditado.

El repositorio también mantiene un control documental de claims comerciales: `docs/product/brand.md` prohíbe afirmar certificaciones o readiness que no tengan evidencia.

## 3. Resultado

**No se encontró un patrón oscuro crítico en la superficie revisada.**

Esto no equivale a una certificación universal de ausencia de dark patterns. El producto no tiene todavía un gate automatizado específico para esta categoría.

## 4. Regla de continuidad

Cualquier nueva pantalla de contratación, precios, consentimiento, cancelación, soporte comercial o marketing debe pasar esta revisión antes de considerarse materializada.

No crear una segunda política ni rehacer la navegación actual sólo para marcar este requisito.

# Declaración sobre el uso de inteligencia artificial — Camacho POS Colombia

> **BORRADOR — DOCUMENTED únicamente. No publicar sin revisión de abogado colombiano y sin completar los campos [PENDIENTE].**
> Este texto no es asesoría legal. Redactado el 2026-09-26.

## 1. Declaración

**Camacho POS Colombia se desarrolla con ayuda de herramientas de inteligencia artificial.**
**El software, tal como existe hoy, no aplica inteligencia artificial a los datos personales de
sus usuarios ni de los clientes de los comercios.**

Son dos afirmaciones distintas, y se sostienen por separado.

## 2. La IA en el desarrollo

Parte del código, las pruebas y la documentación se redactan con asistentes de programación
basados en IA, bajo la dirección y revisión del propietario del proyecto. El repositorio lo
registra:

- Las reglas del proyecto nombran a **Claude** (Claude Code, de Anthropic), **Codex** y **ChatGPT**
  (de OpenAI) como herramientas que han trabajado sobre el repositorio (`CLAUDE.md`, sección «UNA
  SOLA RAMA», regla 3).
- Los commits hechos con Claude Code llevan la marca `Co-Authored-By: Claude …` en el historial de
  git.

Estas herramientas trabajan sobre el **código fuente**, no sobre la operación de los comercios.

[PENDIENTE — confirmar por escrito que ningún dato personal real de comercios o de sus clientes se
comparte con herramientas de IA durante el desarrollo o el soporte, y fijar la regla interna que lo
garantice.]

## 3. La IA en el producto: no existe hoy

Medido en el código el 2026-09-26: ningún fichero de `apps/` ni de `packages/` importa un SDK de IA
(OpenAI, Anthropic, Gemini u otro) ni llama a un servicio de IA. Una búsqueda de la cadena `llm` sí
da resultados, pero todos son la palabra «enro**llm**ent» (inscripción de dispositivos), no modelos
de lenguaje. Las 28 dependencias externas del monorepo, medidas ese mismo día, están listadas en
`terceros-y-encargados.md` §4 y ninguna es de IA.

Por tanto, hoy:

- no se toman **decisiones automatizadas** con IA sobre personas (crédito, precios, fraude u otras);
- no se usan datos personales para **entrenar** modelos;
- no se envían datos personales a **proveedores de IA**.

## 4. Compromiso para el futuro

Si se incorpora una función de IA al producto, antes de activarla se publicará:

1. qué función la usa y con qué finalidad;
2. qué datos recibe, y si incluyen datos personales;
3. qué proveedor la presta y dónde procesa los datos (se añadirá a `terceros-y-encargados.md`);
4. si toma o apoya decisiones sobre personas, y cómo pedir revisión humana;
5. si los datos se usan para entrenar modelos (por defecto: **no**).

Una función así cambiaría la finalidad del tratamiento y exigiría actualizar
`politica-tratamiento-datos.md` y, cuando corresponda, pedir nueva autorización.

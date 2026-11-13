<p align="center">
  <img src="docs/brand/camacho-pos-colombia-login.png" alt="Camacho POS Colombia" width="640">
</p>

# Camacho POS Colombia

POS local-first para operación comercial en Colombia. El servicio local mantiene SQLite/WAL como único escritor; las pantallas consumen casos de uso a través del canal autorizado. La nube complementa la operación local mediante identidad, administración y sincronización.

**Estado: consolidación en desarrollo. No es todavía una distribución comercial certificada para todas las plataformas.**

## Una sola línea de trabajo

- Rama activa existente: `cursor/commercial-design-review-0d11`.
- Entrega hacia `main`: [PR #106](https://github.com/Andresito202/pos-platform/pull/106), Draft, sin fusionar.
- No abrir otras ramas, shells ni diseños alternativos. El nombre histórico de la rama no convierte el lanzador de revisión visual en el arranque comercial.
- PR #92, #94, #95 y #99 cerradas como reemplazadas por #106: sus HEAD eran ancestros del incremento `a21c3e79`. El cierre no certifica sus capacidades.
- Android, balanza y QR tienen deltas exclusivos pendientes de evaluar e incorporar selectivamente. No se consideran integrados por compartir repositorio.

La rama elegida contiene el historial de login local y Windows P0 y recupera `SalePanel.tsx`, que estaba sustituido por un marcador en `e31e008a`. `main` es el destino de entrega, no otra línea de desarrollo simultánea.

## Dónde se trabaja

| Superficie | Código real | Estado y límite |
|---|---|---|
| Windows / Linux | `apps/pos-desktop` | Electron + React; componentes comerciales conectados. Distribución y operación por sistema requieren verificación propia. |
| Servicio local | `apps/pos-local-service` | Canal, sesiones, casos de uso, SQLite, outbox y hardware. Los controles SCM/DPAPI de Windows siguen vigentes. |
| Android | `apps/pos-android` | Runtime nativo y APK de diagnóstico; todavía no contiene las pantallas React comerciales. No equivale al APK independiente de impresión instalado en el equipo. |
| Nube | `apps/central-authority` | Autoridad e integración central; existencia del código no acredita despliegue productivo. |
| Portales web | `apps/pos-desktop/renderer/src/platform-entry.tsx` y `pricing-entry.tsx` | Administración GLOBAL y ofertas; comparten marca, no la autoridad de una sesión local. |
| Dominio compartido | `packages/` | Contratos, aplicación, dominio, persistencia y adapters. |

## Pantallas y permisos

Las pantallas reales están en `apps/pos-desktop/renderer/src/components/`. `App.tsx` monta la navegación autorizada; `SalePanel` usa `useCommercialSale`, que invoca el canal existente. No se crea un POS visual separado.

| Perfil local de desarrollo | Área principal | Caja/carrito |
|---|---|---|
| Cajero | Venta, cobro, clientes y comprobantes según permisos | Sí |
| Supervisor | Inventario, catálogo y revisión de transferencias | No |
| Administrador | Administración, auditoría y gestión autorizada | No |
| Superadministrador local | Administración y operación del negocio vinculado al servicio | Sí, con permisos y turno; sin autoridad GLOBAL implícita |

La separación local se aplica también en backend: supervisor y administrador no pueden crear ventas; el superadministrador local puede operar el negocio vinculado al servicio, según la decisión del propietario del 13 de noviembre. Las sesiones comerciales firmadas dependen de sus permisos emitidos por Central; esta matriz local no sustituye SSA/SAS ni certifica BUSINESS.

## Marca y diseño

La identidad vigente es el logo amarillo/naranja aportado por el propietario. Se usan sus variantes horizontal, apilada e icono Android, con proporciones intactas y fondo claro. Los dos PNG azul/verde anteriores se retiran del árbol activo.

`BrandMark.tsx` y `brand.css` centralizan la marca del renderer. Central usa el mismo horizontal. El empaquetador Android consume el icono original desde `docs/brand`, sin mantener otra copia. La especificación y el inventario están en [Marca](docs/product/brand.md).

El diseño debe funcionar sobre operaciones reales: controles visibles según rol, importes COP legibles, estados de error/pendiente explícitos y acciones táctiles accesibles. Un logo nuevo o un build correcto no acreditan una revisión visual completa.

## Desarrollo y comprobaciones

Usar pnpm 9.15.0 y las versiones fijadas en `package.json` / `pnpm-lock.yaml`.

```sh
pnpm install --frozen-lockfile
pnpm --filter @pos-platform/pos-desktop test
pnpm --filter @pos-platform/pos-desktop typecheck
pnpm --filter @pos-platform/pos-desktop build
pnpm --filter @pos-platform/pos-local-service typecheck
pnpm architecture:check
```

Electron ejecuta `dist/start.bundle.mjs` y carga `dist/renderer/index.html`. Cambiar TSX sin reconstruir no actualiza una ventana ya abierta. `start:production` exige aprovisionamiento y controles de arranque válidos; no se deben desactivar para mostrar las pantallas.

Android tiene requisitos de NDK, firma y runtime propios: seguir [su procedimiento](apps/pos-android/README.md). El lanzador de login local es para desarrollo; los lanzadores de previsualización y revisión visual no acreditan autenticación comercial.

## Rediseño basado en referencias del propietario

Login con usuario escrito y contraseña visible opcional; navegación plegable con flechas y cierre de sesión dentro del menú; carrito compacto; selección del medio separada de la confirmación; billetes y teclado opcionales. Se conservan canal, casos de uso y permisos existentes. La transferencia se reporta: no se presenta como ingreso bancario confirmado.

Incremento validado con 277 pruebas desktop, TypeScript renderer y build. La comparación visual está bloqueada por la conexión del navegador a la vista previa; no se declara fidelidad 1:1 ni rediseño completo. Ver [QA de diseño](design-qa.md).

## Evidencia y pendientes

La separación de roles de `a21c3e79` tuvo 273 pruebas desktop y 19 focalizadas de backend aprobadas, además de TypeScript renderer/local-service y build renderer. Se usaron dependencias de caché; no fue una instalación reproducida con frozen-lockfile ni una certificación Windows.

Pendientes del producto: integración de deltas exclusivos Android/balanza/QR; login BUSINESS y SCM completo; pantallas comerciales Android; empaquetado por plataforma; revisión visual en resoluciones reales; ventas, persistencia, offline, impresión y dispositivos de extremo a extremo. La instalación y las modificaciones sin publicar del PC no se han inspeccionado desde esta sesión.

La limpieza elimina duplicación demostrada, no capacidades útiles por estar incompletas. No se eliminan bases de datos, migraciones ni pruebas históricas para reducir el árbol.

## Documentación operativa

- [AGENTS.md](AGENTS.md): reglas para colaboradores y otras IA.
- [Backlog único](docs/product/backlog.md): prioridad y decisiones de integración/retiro.
- [Gobernanza](docs/governance/repository-governance.md): publicación, PR y entrega a main.
- [Tablero de materialización](docs/governance/tablero-materializacion.md): niveles de evidencia; sus filas históricas conservan su SHA.
- [Arquitectura](docs/architecture/) y [ADR](docs/adr/): contratos y decisiones.
- [Verificación de roles](apps/pos-desktop/e2e/ROLE-UX-CONSOLIDATION.md).

Los informes antiguos son evidencia de su fecha y commit, no el estado actual del producto. Una prueba aprobada no equivale a operación productiva observada.

## Cargue de existencias y validación de integraciones (2026-11-10)

Inventario ofrece plantilla CSV UTF-8 editable en Excel, vista previa y confirmación por fila contra `inventory.stock.receive`. La plantilla de catálogo sigue siendo distinta: crear productos no carga stock. No hay lectura nativa XLSX. Los identificadores de lote/fila deben conservarse en los reintentos; cambiar cantidades con la misma identidad produce conflicto en el servicio, no una segunda entrada.

La auditoría de Factus, licencias e inventario y sus límites están en [Estado de integraciones](docs/product/integration-verification-20261110.md). **No está acreditado el despliegue comercial completo.**

## Superadministración de licencias

El portal GLOBAL incorpora la pestaña **Licencias**: consulta paginada de activaciones y revocación con confirmación, conectadas a Central y protegidas por LICENSE_REVOKE. No se ofrece esta autoridad a una sesión local de desarrollo. Revocación central y recepción del bloqueo por una caja offline son estados diferentes. La interfaz también conecta emisión desde pago confirmado y asignación de cajas mediante referencias registradas en Central. El formulario consulta la empresa por nombre, sucursales activas y dispositivos con credenciales vigentes a partir de la licencia. La caja conserva su referencia local; el flujo HTTP/SQL ya pasó en PostgreSQL 16.14 y la comprobación visual en Electron Windows sigue pendiente; consultar el estado de integraciones enlazado arriba.

## Verificación física de Central — 11 de noviembre de 2026

TypeScript completo de Central aprobado tras instalar la dependencia WebAuthn fijada. Ocho escenarios físicos de pagos y suscripciones aprobaron con PostgreSQL 16.14 aislado, HTTPS local y comprobación de capacidad en SQLite. Incluyen las consultas de activaciones y opciones de asignación. El proveedor Factus se simula mediante servidor TLS local: no acredita su sandbox externo ni facturación electrónica real. Electron Windows no se ejecutó en Linux. Alcance y reproducción: [Evidencia de Central](docs/testing/central-physical-20261111.md).

Los movimientos manuales de inventario conservan su solicitud ante respuestas no concluyentes mientras la pantalla permanece montada. Esto no sustituye la recuperación durable tras cierre o pérdida de sesión; ese escenario continúa pendiente y está detallado en el estado de integraciones.

La pantalla fiscal bloquea una nueva emisión de la venta ante resultado incierto, conciliación requerida o respuesta no verificable. El bloqueo visual no sustituye los estados durables del backend ni acredita conciliación con Factus; no hay conciliación automática implementada por este incremento.

La emisión fiscal distingue aceptación y rechazo: `FISCAL_REJECTED` no se presenta como `ISSUED`, y repetir la solicitud recupera el rechazo persistido sin reenviar. Validación de este incremento: 33 pruebas fiscales y 306 desktop aprobadas; no equivale a certificación del sandbox externo. «En espera» ya guarda y recupera carritos en SQLite desde Caja, con control de versión, recuperación del turno propio abierto y eliminación con confirmación. Solo opera antes del cobro. Alcance, pruebas y límites: [Clientes en espera](docs/product/waiting-carts.md).


## Incremento del 13 de noviembre: caja e inventario

Se conserva la única rama activa. Caja permite vincular un cliente existente al carrito en espera, recuperar su referencia y separar Nequi/Daviplata de otras transferencias. Registrar una transferencia no confirma un ingreso bancario. Los precios se muestran en COP sin ceros de escala sobrantes; las cantidades contractuales no se redondean.

El adaptador de mostrador exige un turno abierto antes de crear ventas; se comprueba en la transacción de SQLite y se conserva el reintento de ventas ya creadas. La apertura explica rechazos junto al formulario. Falta la habilitación/asignación desde Administración; el identificador de caja todavía debe corresponder a una caja publicada.

Inventario valida precisión de presentación (entero/peso), saldo máximo y empresa antes de registrar movimientos. [Tipos de comercio](docs/product/business-types.md) identifica el soporte real y lo que falta para fruver, avícola, droguería y pastelería. Lotes, FEFO, despiece y recetas no están disponibles como flujo completo. La ficha de cliente del carrito no se propaga automáticamente a la factura final.

Evidencia y límites en [verificación de integración](docs/product/integration-verification-20261110.md). Este incremento no acredita distribución comercial, sincronización completa entre dispositivos ni pruebas físicas Windows/Android.


## Licencias y roles — continuidad del 13 de noviembre

La licencia de capacidad se revalida en cada nueva venta, no solamente al abrir turno. Una caja abierta no extiende la vigencia firmada. El límite emitido por Central ya incluye los tres días (72 horas) de gracia de suscripción: el servicio no añade otros tres días. Al cumplirse el instante de vencimiento firmado, las nuevas ventas quedan bloqueadas. El replay de una venta registrada conserva su identidad; no se deshacen ventas ni se impide resolver pagos ya iniciados por este cambio.

El superadministrador local puede vender y administrar catálogo/inventario dentro del negocio configurado en el servicio; no cambia libremente de empresa ni adquiere LICENSE_PLAN_MANAGE. Las licencias se administran mediante el portal y APIs GLOBAL con autorización propia. Supervisor y administrador siguen sin Caja.

Las pruebas separan el bloqueo por política en canal real, la expiración de artefactos firmados en SQLite y las fronteras temporales centrales. No acreditan todavía el recorrido externo pago→renovación→descarga→desbloqueo ni revocación inmediata de equipos desconectados.

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
| Superadministrador | Administración de plataforma | No |

La separación local se aplica también en backend: supervisor, administrador y superadministrador no pueden crear ventas. Las sesiones comerciales firmadas dependen de sus permisos emitidos por Central; esta matriz local no sustituye SSA/SAS ni certifica BUSINESS.

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

El portal GLOBAL incorpora la pestaña **Licencias**: consulta paginada de activaciones y revocación con confirmación, conectadas a Central y protegidas por LICENSE_REVOKE. No se ofrece esta autoridad a una sesión local de desarrollo. Revocación central y recepción del bloqueo por una caja offline son estados diferentes. La interfaz también conecta emisión desde pago confirmado y asignación de cajas mediante referencias registradas en Central. El formulario consulta la empresa por nombre, sucursales activas y dispositivos con credenciales vigentes a partir de la licencia. La caja conserva su referencia local; la verificación física del flujo sigue pendiente; consultar el estado de integraciones enlazado arriba.

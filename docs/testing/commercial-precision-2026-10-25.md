# Commercial Precision B — implementación sobre el POS existente

Base local/remota `f6284749d0c8dde464506531fa3c37a4658b35f9`, única rama
`feat/android-commercial-runtime`, PR #96 draft. El propietario aprobó B mediante
«Apruebo B» y ordenó continuar. Esta aprobación es **visual**, no aprobación de
DEV-003, D3, SEC-004, DEC-025, despliegue o nuevas funciones comerciales.
`docs/product/oracleJdk-27/` conservado intacto; sin acceso a respaldos externos
o `.claude-desactivado`. No nuevas ramas, dependencias o migraciones.

## Implementación

| Superficie | Cambios de presentación reales | Contratos conservados |
| --- | --- | --- |
| Fundamentos | `renderer/src/design-tokens.css`, fuente offline Bahnschrift/Segoe UI/system-ui, azul/verde B, foco, densidad 36/48 px por tipo de puntero | Sin privilegios, identificadores o sesión derivados del tema |
| Shell / estados | `App.css` usa una sola declaración de tokens; `commercial-precision.css` aplica B sobre selectores existentes. Navegación azul oscura, logo original sobre blanco, estado de acceso claro, sin gradientes/sombras grandes/animaciones decorativas | Mismos estados de autorización y lista de pantallas derivada de capacidades. Skip link accesible al área de trabajo; sin métodos nuevos de preload |
| Catálogo | Tabla nativa del listado ya recibido, presentación/precio/ID exactos, búsqueda y cargar más existentes; preview CSV con tabla desplazable y caption; alta con etiquetas visibles/retícula | Misma consulta, paginación, campos, cantidades, validaciones CSV y escrituras por contrato. Sin selección/ordenación/filtros artificiales |
| Inventario | Etiquetas visibles, agrupación de entrada/ajuste/consulta y retícula adaptable | Sigue siendo consulta por presentación; no tabla masiva, costos o endpoints inventados |
| Administración / auditoría | Métricas reales reorganizadas como banda, pestañas con subrayado, eventos en table/th/td con caption y región de scroll con teclado | Mismos hooks, alcance, resultados y paginación. Sin métricas o permisos fabricados |
| Ventas / clientes / recibo / fiscal / hardware | Densidad, controles, contornos, colores, foco y responsive del sistema compartido | No se cambian handlers de cobro, confirmación, cálculos, política fiscal, permisos o hardware. Las funciones pendientes siguen pendientes |
| Formulario HTTPS | `commercial-browser-entry.ts`: soporte claro del logo, dos columnas y adaptación estrecha, controles/estados B dentro de la CSP nonce existente | Script, destinos, CSRF, WebAuthn, PKCE, cookie, callback y headers de seguridad conservados. Ningún endpoint nuevo ni montaje productivo |

La marca «próximamente» se retiró sólo de Dashboard y Auditoría, que ya renderizan
componentes ejecutables; no se cambió su gate de permisos ni se habilitaron otras
definiciones planificadas. La implementación no introduce módulos futuros de
compras, reportes, proveedores, traslados o superadministración.

Los estilos base existentes se conservan y la capa aprobada se importa después;
los dos bloques conflictivos de variables se consolidaron en un único archivo.
No se creó otro conjunto de componentes comerciales ni un framework UI paralelo.
Los tokens de colores del formulario HTTPS son una proyección explícita de B
dentro del documento con nonce; no importa código renderer en Central.

## Evidencia visual

| Captura | Procedencia y límite |
| --- | --- |
| [Acceso escritorio](commercial-precision-2026-10-25/access-desktop.png) / [390 px](commercial-precision-2026-10-25/access-mobile.png) | Renderer compilado real en navegador sin bridge: denegación por Service ausente; no se inyectó sesión |
| [Catálogo táctil](commercial-precision-2026-10-25/catalog-touch-static.png) / [Inventario táctil](commercial-precision-2026-10-25/inventory-touch-static.png) | Componentes reales renderizados estáticamente, sin datos/capacidades, sin efectos/hidratación, con subtree inert. No es un POS autenticado |
| [Ventas](commercial-precision-2026-10-25/sales-desktop-static.png) | Mismo componente existente y estados iniciales; ninguna venta, precio o pago de demostración |
| [Login HTTPS](commercial-precision-2026-10-25/central-https-login-lab.png) | Electron y servidor HTTPS de laboratorio existentes; captura antes de llenar correo/contraseña. Metadata de fixture canónica, nunca provisión real |
| [Dashboard Electron](commercial-precision-2026-10-25/dashboard-electron-lab.png) | E2E Windows/Service/DPAPI/PostgreSQL temporal, autenticador virtual, snapshot canónico; sólo AUDIT_EVENT_READ y catálogo UNAUTHORIZED. «Sin permiso» se conserva para métricas no autorizadas |

Se reutilizó el driver Electron del login y su directorio de evidencia. Para los
otros paneles no se utilizó el preview histórico con lista de capabilities
simuladas: es incompatible con la exigencia de no fabricar permisos. El helper
de revisión estática importa componentes reales y entrega HTML inert sin sesión,
sin ejecutar hooks de efectos ni crear handlers de operaciones. No está en el
entrypoint o build productivo; configuración TS propia porque el helper corre en
Node SSR y necesita los tipos Node ya instalados.

El script `tools/design/verify-commercial-precision.mjs` usa Edge/Playwright
existentes y servidor GET temporal de loopback acotado al renderer compilado y
componentes en allowlist. Se cierra al finalizar. No hay DB o transporte de producto
en ese helper. Las capturas nuevas no sobrescriben las propuestas históricas.

## Pruebas ejecutadas

Salidas locales: `artifacts/commercial-precision/2026-10-25/`.
[Manifest con casos, hashes y archivos](commercial-precision-2026-10-25/evidence.json).

| Selección | PASS | FAIL final | Omitidas |
| --- | ---: | ---: | ---: |
| Renderer afectado por CSS, estructura y tablas | 134 | 0 | 0 |
| HTTPS entry/CSP sin efectos + Electron con custodia real | 2 | 0 | 167 |
| **Casos distintos** | **136** | **0** | **167** |

Revalidación focal tras últimos ajustes: 37 PASS de paneles/CSV/status y 1 PASS
Electron (168 omitidas); se solapan con los anteriores, no se suman. La captura
final espera revalidación legítima por foco y frames pintados, sin quitar listeners
o invalidaciones. PostgreSQL 16 tmpfs dedicado, bind 127.0.0.1:55433; sólo DB
aleatorias propias creadas/eliminadas por el harness existente. No bases comerciales.

- TypeScript Desktop/Central y helper SSR: PASS. Build completo Electron: PASS;
  renderer revalidado tras últimos cambios: PASS.
- 4 layouts del acceso real y 32 composiciones estáticas: sin overflow horizontal
  del documento, ningún bridge inyectado, cero excepciones JS. Puntero coarse real
  del contexto browser para verificar controles de acceso ≥48 px.
- Revisión manual de las capturas anteriores; no auditoría WCAG integral, lector
  de pantalla físico o certificación de teclado virtual Android.
- ARCH-003: 16 pruebas PASS y fronteras PASS. Política/diff-check PASS.
- Revisión React: claves estables, sin efectos/subscripciones nuevas, sin librerías,
  tabla semántica y foco accesible. Los tests de auditoría comprueban columnas y
  celdas reales; no se añade una API para datos de diseño.
- Comparación AST: 76 atributos de handlers/disabled de App/Catalog/Inventory/Admin
  idénticos al baseline. Script de login y respuesta/headers idénticos tras normalizar
  CRLF/LF. No claim de ausencia global de vulnerabilidades.

Performance observada de assets (no benchmark CPU): CSS gzip 5.14→6.82 kB;
JS renderer gzip 108.37→108.86 kB; logo sin cambios. 167→168 módulos Vite por la
capa/tokens visuales; sin dependencias o fuentes remotas nuevas. No se implementa
virtualización sin contrato/volumen que la justifique.

### Fallos intermedios conservados

Un cierre JSX de retícula quedó sin apertura en catálogo: TypeScript/build y la
primera selección lo detectaron; corregido antes de resultados finales. Después,
un test antiguo de StatusPanel esperaba el texto crudo «connection refused» aunque
el canal existente lo sanitiza a LOCAL_SERVICE_UNAVAILABLE. Se corrigió sólo la
expectativa y se comprueba que el texto crudo no se filtra; no cambió el canal.

El helper de captura necesitó JSX automático, corregir orden de headers/lectura y
tipos Node para SSR. Una captura Electron capturaba el frame anterior de carga;
se esperó el foco/revalidación y pintura reales y se revalidó. El comparador de
invariantes se ajustó a CRLF/LF, no a diferencias de lógica. Salidas iniciales
permanecen en artifacts; no se ocultan como ejecución perfecta.

## Reproducción

```powershell
pnpm --filter @pos-platform/pos-desktop --filter @pos-platform/central-authority run typecheck
pnpm --filter @pos-platform/pos-desktop exec tsc -p e2e/tsconfig.visual.json
pnpm --filter @pos-platform/pos-desktop exec vitest run tests/renderer
pnpm --filter @pos-platform/pos-desktop build
pnpm --filter @pos-platform/pos-desktop exec esbuild e2e/visual-components.tsx --bundle --platform=node --format=esm --jsx=automatic --external:react --external:react/jsx-runtime --external:react-dom/server --loader:.css=empty --outfile=dist/visual-components.mjs
node tools/design/verify-commercial-precision.mjs
# PostgreSQL tmpfs/roles y probes: procedimiento P0-04 existente.
$env:POSTGRES_TEST_URL='postgresql://postgres@127.0.0.1:55433/postgres'
$env:POS_E2E_AUDIT_DIRECTORY='C:\Proyectos\pos-platform\artifacts\commercial-precision\2026-10-25\electron-final'
pnpm --filter @pos-platform/central-authority exec vitest run tests/business-access-preparation-physical.test.ts -t 'HTTPS browser entry: exact registered|central SAS: Electron.*custody=true'
node --test tools/architecture/validate-boundaries.test.mjs
node tools/architecture/validate-boundaries.mjs
pnpm ci:repository-policy
git diff --check
```

## Estado y límites

Dirección B aplicada a las superficies existentes, con código integrado y gates
locales; no sólo mockups. El preview A/B/C conserva su historia y la aprobación
actual queda registrada. Codex Security se confirmó instalado/ENABLED el 2026-10-25;
no se atribuye ningún escaneo del plugin a este incremento. Se usaron guías
frontend/UI y revisión preventiva de seguridad/React.

Windows/Electron comprobado en el entorno aislado anterior; Android/Linux conservan
el código compartido y adaptación CSS, **no** certificación física nueva ni APK.
Funciones pendientes de backend permanecen pendientes. Diseño aprobado no crea
listado masivo de stock, compras, permisos, sesión comercial o provisión.

PR #96 draft, sin merge. CI remoto pendiente de restablecimiento por facturación
según propietario, previsto 2026-11-01; workflows intactos, no CI verde. Login
humano y producción continúan bloqueados por entorno Central real, DEV-003,
confianza SAS y políticas/migraciones enumeradas en la propuesta conjunta vigente.

# Estado verificable de continuidad comercial — 2026-10-22

Base inicial comprobada limpia/sincronizada `f1e5a0bb21009608eb49f6f0dcd6435e0d39bd37`. Una sola línea `feat/android-commercial-runtime`, sin merge/main/rebase ni cambios a bases persistentes. Corte de código publicado: **`e9a07458667d9241ce36374c7078ca5bdf6aa88f`**. Este informe no declara cierre integral ni producción.

## Incrementos publicados

| Commit | Resultado / evidencia |
| --- | --- |
| `f27cddd` | [Local-security Android y enrolamiento canónicos](android-security-composition-2026-10-22.md), dependencias confiables explícitas, clave certificada ligada a identidad local y auditoría completada; 16/16 |
| `2dc2272` | [D-23](sold-identifier-2026-10-22.md), identificador escaneado/seleccionado validado y congelado, compatibilidad de callers anteriores; 49 ventas, 1 contrato, 34 renderer |
| `4945213` | [Alta fiscal D-19](catalog-fiscal-write-2026-10-22.md), formulario/contrato/writer existentes, validación canónica y commit atómico; 20 catálogo, 6 renderer, 1 canal real |
| `da02815` | [CSV recuperable](catalog-csv-2026-10-22.md), plantilla/vista previa/duplicados/coincidencias/confirmación por fila, sin stock; 5 parser/orquestación, 7 panel, 1 aislamiento de empresa |
| `82c7eea` | [Fronteras de permisos](commercial-role-boundaries-2026-10-22.md), 11 pruebas nuevas de denegación catálogo/recepción/ajuste y clasificación de errores de validación |
| `e9a0745` | [Cantidades de recepción](receipt-quantity-preparation-2026-10-22.md), conversión exacta y suma de asignaciones, 7 focalizadas; propuesta conjunta de confianza/distribución |

Los recuentos de suites se solapan; no se suman como pruebas distintas. Salidas/entornos/comandos y fallos de fixtures corregidos están en cada informe. TypeScript de local-service, contracts, local-channel y desktop/renderer aprobó; ARCH-003 (16 checks), política de archivos rastreados y diff sin errores aprobaron. `build:renderer` Vite aprobó, 165 módulos, JS 373.68 kB/gzip 107.26 kB; log local `artifacts/android-runtime/2026-10-22/commercial-increments-renderer-build.log`. No se reconstruyó la ABI/SQLite/Argon/MFA ni se repitieron E2E comerciales históricos.

## Estado por componente

| Componente | Estado real |
| --- | --- |
| Android autónomo | **Parcial**. Motor/Service/custodia físicos previos conservados; nueva composición de seguridad probada en desarrollo, sin caller APK productivo |
| Seguridad y BUSINESS | **Bloqueado** por ausencia confirmada de activación/confianza centrales reales y aprobación SEC-004/D3/DEC-025. No se emite sesión ni credencial utilizable nueva |
| React | Compartido y ampliado con funciones de catálogo, sin rediseño; **no conectado al Service Android**. Origen/canal aprobados pendientes |
| Ventas/pagos/caja | Motor existente preservado; D-23 corregido y probado. **Ninguna venta/pago/caja real Android ejecutada** en este corte |
| Catálogo/inventario/compras | **Parcial**. Alta fiscal, CSV y preparación exacta nuevas. No GoodsReceipt completo, PurchaseOrder, documento proveedor/AP/pago, lotes, conteos/kardex/traslados/reserva completos. D-21/D-22 abiertos; categorías/marcas/maestros/conversiones publicadas requieren reconciliación de distribución |
| Roles/aprobaciones | Denegaciones backend probadas; **sin productor/grants centrales nuevos ni workflow crítico de aprobación/autoaprobación materializado** |
| Recibos/impresora | Recibo existente consume el identificador congelado. ASCII físico histórico conservado; **PRINT_RECEIPT comercial autónomo no certificado**. Sin impresión/corte nuevos |
| Cajón CD350 | **Bloqueado** por `f03e66c`; voltaje/corriente/pinout/puerto/cable/pulso no certificados. Ningún pulso ni apertura automática |
| E2E físicos de este corte | **Ninguno**. Solo lecturas ADB de estado/patch/WebView; no se presentan como certificación de hardware o login |
| PR | #96 draft, base original de #92 conservada; #92 OPEN/draft en b907d20. Sin merge ni cambio de base |
| CI | **No verde**. Strix sobre código e9a0745 falló sin iniciar job por facturación/límite de gasto de GitHub; no fallo observado de código ni pentest ejecutado |

APK físico conservado, sin recompilar ni instalar otro: `apps/pos-android/build/runtime-apk/camacho-node-runtime-probe.apk`, SHA-256 **`3f9b801420b4b6f64cd076d6ec37eaa89aab9a9226671db79c78008a792fe9eb`**. Su hash se volvió a leer. No incluye los nuevos componentes sin caller y no se le atribuyen sus tests de software. Los APK no entran en Git.

CI consultado: [run 39777771421](https://github.com/Andresito202/pos-platform/actions/runs/39777771421), head exacto e9a07458667d9241ce36374c7078ca5bdf6aa88f, check 119820988447. La anotación indica que el job no inició por pagos recientes fallidos o por necesitar aumento del límite de gasto. No se cambia facturación ni se marca PASS por pruebas locales. Los workflows orientados a main no equivalen a una matriz ejecutada en esta PR apilada.

## Próximo paso condicionado, sin credenciales inventadas

Resolver la **[propuesta única DEV-003/SEC-004/D3/DEC-025](android-commercial-approval-proposal-2026-10-22.md)** con datos reales y aprobación explícita. Incluye cómo obtener configuración/activación/artefactos públicos de forma segura, candidatos y riesgos, y la reconciliación de maestros/políticas de inventario frente al discriminador cerrado CASH_REGISTER. El propietario confirmó que esas decisiones no están aprobadas; este informe no las sustituye.

El código que queda por implementar se conserva como pendiente, no se atribuye solo a configuración: intercambio externo/verificador de acceso, transporte Android aprobado, productor de autorización vigente, proyecciones maestras autorizadas y persistencia completa de recepción/reserva/reversión. Los lectores binarios XLSX y mappings XML tampoco se declaran hechos; actualmente se acepta CSV exportado desde Excel. No se crea otro POS, catálogo maestro local o tabla paralela para simular estos eslabones.

# Camacho POS Colombia — certificación integral (corte 2026-11-16)

**SHA técnico inspeccionado:** `57721afabf2fef50fd9d374e8dad95c5d2ef215d`  
**PR:** [#106](https://github.com/Andresito202/pos-platform/pull/106), Draft; rama `cursor/commercial-design-review-0d11`; **sin merge**.  
**Método:** revisión remota de código, historial y jobs de GitHub Actions; no se dispuso del PC de instalación, APK comercial ni credenciales de terceros. Los comandos de suites fueron ejecutados por los runners de GitHub, **no desde esta sesión**. El commit que publique este documento tendrá un nuevo HEAD y necesitará CI exacto propio.

## 1. Decisión

**NO-GO para distribución comercial general Windows + Android + Central.** La base compartida funciona en tests de componentes e integración delimitada, pero no existe evidencia de un único E2E de 4 roles, 3 empresas y licencias distintas, 3 sectores, multi-caja offline→sync, sesiones BUSINESS físicas, hardware Android comercial y proveedores externos. No convertir una suite verde en aprobación de producción.

## 2. Bloques del historial revisado

| Bloque | SHAs representativos | Evidencia | Límite |
|---|---|---|---|
| 1–3: núcleo, login, roles, licencias y Caja | Historial anterior a M022; `docs/product/roles-modules-verification-20261113.md`, `docs/testing/controversies-1-5-20261114.md` | módulos y pruebas de autorización local | No se recalificó cada commit ancestral ni se acreditó login BUSINESS físico |
| 4: Inventory lotes, conversión, reserva | `9717ee78`, `04a874b5`, `517febc8`, `321d09db` | M022–M024, FEFO, tests de inventario y reserva | Sin 3 cajas físicas |
| 5: Salsamentaria | `17b84fc0`, `f6f4194c` | M025, `salsamentaria-transform.test.ts`, merma documental, genealogía MIXED | Sin balanza en Caja del HEAD |
| 6: Farmacia | `a995e744`, `fada343e`, `d24345a1` | M026, `farmacia-*.test.ts`, gates de efectivo/transferencia y conciliación | Control especial bloqueado; requisitos INVIMA/FNE externos |
| 7: Pastelería | `4c87ba1b`, `037ebed6`, `c3f6946e`, `57721afa` | M027–M029, `pasteleria-production.test.ts`, permisos y autorizaciones backend | Sin producción física |

## 3. Gates reales del SHA técnico

| Workflow | Run | Resultado y alcance |
|---|---|---|
| TARGET Foundation | [43956368240](https://github.com/Andresito202/pos-platform/actions/runs/43956368240) | SUCCESS; contratos, dominio, aplicación, fiscal adapters, runtime, SQLite, PostgreSQL 16.14, renderer, typecheck, Windows runner, SBOM/provenance |
| Central Sync | [43956368245](https://github.com/Andresito202/pos-platform/actions/runs/43956368245) | SUCCESS; PostgreSQL 16.14 aislado, sync y replay, no 3 cajas físicas |
| D-3 Live Security E2E | [43956368274](https://github.com/Andresito202/pos-platform/actions/runs/43956368274) | SUCCESS; authority/enrollment en TLS y DB efímeros |
| G1.2 Session Bootstrap | [43956368256](https://github.com/Andresito202/pos-platform/actions/runs/43956368256) | SUCCESS; Windows hosted runner, no PC destino |
| CodeQL SAST | [43956368304](https://github.com/Andresito202/pos-platform/actions/runs/43956368304) | SUCCESS; análisis estático, no pentest |
| Strix | [43956368233](https://github.com/Andresito202/pos-platform/actions/runs/43956368233) | SUCCESS **con scan NOT RUN**. El job reporta `Report that the scan did not run`; credenciales/configuración ausentes. No existe pentest Strix de ese SHA. |

**Importante:** un resultado `SUCCESS` del workflow Strix **no** significa escaneo ejecutado. `Main push governance` fue SKIPPED por tratarse de PR, no push a main.

## 4. Matriz final: IMPLEMENTED / TESTED / END_TO_END / PRODUCTION

Convención: YES=capacidad sustentada por código o pruebas; PARTIAL=existen recorridos parciales o laboratorios; NO=sin evidencia suficiente. TESTED no significa prueba física ni certificación normativa.

| Módulo | IMPLEMENTED | TESTED | END_TO_END | PRODUCTION | Evidencia y bloqueo |
|---|---|---|---|---|---|
| Roles: global/admin/supervisor/cajero | YES | YES | PARTIAL | NO | `local-operator-authorization.test.ts`; E2E Electron por rol requiere Windows, DPAPI, POS_E2E_ROLE y laboratorio firmado; no sesión BUSINESS real completa |
| Licencias, caducidad, revocación y dispositivos | YES | YES | PARTIAL | NO | `license-capacity.test.ts`; ensayos Central aislados, no 3 empresas simultáneas y cajas físicas |
| Caja, Sales y Payments | YES | YES | PARTIAL | NO | `payment.test.ts`, farmacia-payment gates; falta recorrido físico completo, transferencia bancaria real |
| Fiscal y comprobantes | PARTIAL | YES | PARTIAL | NO | `fiscal-issuance.test.ts`, adaptadores; `factus-sandbox.test.ts` usa `describe.skipIf` sin credenciales reales |
| Inventario, lotes, FEFO y reservas | YES | YES | PARTIAL | NO | M022–M024, inventory/sync suites; falta multicaja física/offline |
| Avícola/Salsamentaria | YES | YES | PARTIAL | NO | M025, transform, venta por peso; balanza e impresora no certificados desde flujo completo de este SHA |
| Farmacia/Droguería | PARTIAL | YES | PARTIAL | NO | M026, recepción/receta/cuarentena/dispensación local; FNE, INVIMA y habilitación externa no acreditados |
| Pastelería | YES | YES | PARTIAL | NO | M027–M029, receta, producción, costos, lotes, autorización de desviación; sin elaboración real |
| Offline, outbox, Sync, replay | YES | YES | PARTIAL | NO | `sync-dispatcher.test.ts`, Central Sync gate; faltan 3 cajas reales, reconexión y conflictos bajo carga |
| Nequi/Bre-B / QR y avisos | PARTIAL | YES | PARTIAL | NO | merchant notification y matcher, proyecciones; `UNVERIFIED` no confirma pago bancario |
| Windows/Electron/SCM | PARTIAL | YES | PARTIAL | NO | Windows hosted runtime, G1.2; falta validación comercial en equipo destino |
| Android/M60WL | PARTIAL | PARTIAL | NO | NO | runtime Android base; README distingue APK comercial del APK independiente de impresión |
| Seguridad de despliegue | PARTIAL | YES | PARTIAL | NO | D-3/CodeQL, Strix **NOT RUN**; sin pentest externo ni entorno productivo |

## 5. Pruebas integrales que faltan — NO EJECUTADAS

No localicé un resultado único que certifique estos recorridos acoplados. Se requieren casos automatizados y físicos con IDs diferentes por empresa, sucursal, dispositivo y licencia, lectura de datos antes/después, eventos/ACK, capturas redactadas, SHA exacto y logs:

1. Cuatro roles: acceso legítimo y denegaciones, cambio/revocación/expiración de sesión, GLOBAL sin carrito.
2. Tres empresas con licencias y dispositivos separados: rechazos cruzados en DB/API, cupo de cajas y expiración/revocación offline.
3. Caja: venta, reserva, pago parcial, efectivo/transferencia, comprobante, salida de lotes, idempotencia y compensación.
4. Salsamentaria: peso físico, FEFO, merma y despiece con genealogía, impresión/cajón.
5. Farmacia: recepción técnica, lote vencido/cuarentena, Rx, pago, control especial permanentemente bloqueado.
6. Pastelería: receta versionada, aprobación de desviación, consumo de dos lotes, costo, producción y venta.
7. Cortar Internet, reiniciar servicio, reconectar y verificar Central ACK + segunda caja sin duplicación.
8. Notificación de pago `UNVERIFIED` con monto observado distinto: ningún estado bancario se confirma por aviso informativo.
9. FACTUS: credenciales sandbox legítimas, endpoints reales y respuesta; distinguir sandbox de producción/DIAN.
10. Android comercial instalado/firmado y hardware real, Windows SCM↔Electron + balanza + térmica + cajón.

## 6. Reproducción de suites existentes

Node 22.19.0, pnpm 9.15.0, bases desechables. **Estos comandos son instrucciones, no ejecución desde esta auditoría**:

```bash
git checkout cursor/commercial-design-review-0d11
git rev-parse HEAD
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:contracts
pnpm test:domain
pnpm test:application
pnpm test:fiscal-adapters
pnpm test:runtime
pnpm test:migrations:sqlite
pnpm test:migrations:postgres
pnpm architecture:check
pnpm --filter @pos-platform/pos-local-service exec vitest run tests/salsamentaria-transform.test.ts tests/farmacia-pharmacy.test.ts tests/farmacia-payment-gates.test.ts tests/farmacia-payment-rollback-hold.test.ts tests/pasteleria-production.test.ts tests/payment.test.ts tests/license-capacity.test.ts tests/sync-dispatcher.test.ts
pnpm --filter @pos-platform/pos-desktop build
```

La suite Electron `apps/pos-desktop/e2e/role-isolation.spec.ts` se omite fuera de Windows o sin `POS_E2E_ROLE` y usa snapshot de prueba: no vender como login real. FACTUS Sandbox se omite por defecto sin cuatro variables de credenciales. No registrar secretos, datos sanitarios ni bancarios en evidencia.

## 7. Bloqueos y decisión

**P0:** E2E Windows BUSINESS/SCM físico; Android comercial APK+M60WL; aislamiento real 3 empresas/3 licencias/3 cajas; sincronización offline multicaja; FACTUS/bancos reales cuando sean requisito contractual; cumplimiento/habilitación sanitaria independiente.  
**P1:** faltan E2E comercial completo y recibos/pagos reales, pentest Strix realmente ejecutado, certificación hardware desde el flujo comercial.

No se reprodujeron regresiones nuevas en esta inspección remota que permitan justificar cambios al motor, permisos o migraciones. No se han agregado nuevas pruebas E2E ejecutables ni simulaciones disfrazadas de PASS. **NO-GO comercial general**. Conservar PR #106 Draft y no fusionar ni desplegar hasta evidencias y aprobación explícita del propietario.

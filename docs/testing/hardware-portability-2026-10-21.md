# Hardware y despliegue local — evidencia 2026-10-21

## Continuidad y alcance

Rama única `claude/pos-camacho-bloque-4c-ld43py`, PR #92 draft. Remoto comprobado por fetch: `4e8cd0dcddc9980c0b55ae0f9611cf2971703dd2`. Se conserva el commit local de recuperación `df829f5547b79068a1a54fd2066f20840bfa8fed` sin reescribirlo. La entrega final continúa ese árbol; no hay merge a main. El SHA verificable es el commit que contiene este informe, no una afirmación de CI.

Owner Hardware en POS Local Service (DEC-017). Contratos 1.0.0, perfiles congelados por asociación de caja/sucursal, cuatro permisos canónicos sin grants automáticos, cola SQLite y auditoría append-only. Se añade migración local 018; 001–017 permanecen intactas. La 018 del WIP de recuperación estaba abierta y no se aplicó a bases persistentes durante esta entrega: se completa antes de publicar. Si alguien hubiera aplicado ese WIP a una DB propia, no se debe borrar ni editar su checksum; requiere reconciliación antes de abrirla. Solo se usan directorios SQLite temporales en las verificaciones.

No se toca contraseña, MFA, sesiones centrales ni reserva SSA. No se repiten sus suites PostgreSQL; este incremento no cambia sus contratos. No se modifica ningún dato monetario ni persistencia comercial existente.

## Comportamiento integrado

- `hardware.command` cruza preload/allowlist/canal autenticado, binding SSA y handler comercial existente. Identidad/ámbito provienen del backend; no acepta comandos ESC/POS del renderer. Permisos separados READ, CONFIGURE, PRINT y DRAWER_OPEN, evaluados también al ejecutar.
- `PENDING → DISPATCHING` y su auditoría se confirman antes de I/O. Compare-and-set evita dos emisiones. Un reinicio en DISPATCHING produce UNKNOWN; no hay reintento automático de comandos físicos. Aceptar bytes no demuestra papel impreso ni cajón abierto. No se inventa estado de sensor.
- Recibos usan `GetReceiptUseCase` y hechos congelados (DEC-019), escala decimal textual, caracteres españoles CP1252 con code page explícito del modelo. Controles embebidos se rechazan. Una reimpresión no agrega pulso ni corte. Corte/pulso requieren comandos documentados, sin defaults eléctricos.
- Apertura manual exige permiso/motivo y auditoría. Apertura automática permanece desactivada sin política confiable de operador; su hook solo recibe pago CASH confirmado, vuelve a cruzar pago/asignación/venta COMPLETED/caja/sucursal y deduplica por payment_id. Fallar hardware no revierte un pago confirmado. Un evento ya registrado no se vuelve a despachar, incluso si quedó PENDING. No hay pulso por transferencia, pago rechazado, retry idempotente o reimpresión.
- Transportes reales: TCP a destino explícito, Windows RAW spooler y Linux CUPS. El spooler usa la secuencia de [WritePrinter documentada por Microsoft](https://learn.microsoft.com/en-us/windows/win32/printdocs/writeprinter); no se usa para XPS ni se envió a una cola virtual. USB Android usa API nativa y permiso OS ([Android USB host](https://developer.android.com/develop/connectivity/usb/host)). Bluetooth, serial y SDK propietario tienen vocabulario de contrato, **no implementaciones verificadas**.
- Registro del operador: `POS_HARDWARE_PROFILES_FILE` absoluto, JSON `{schema_version:"1.0.0",devices:[{id,profile,target,timeout_ms}]}`; target TCP `{kind,host,port}` o WINDOWS_SPOOLER/CUPS `{kind,queue}`. Transporte debe coincidir con perfil; perfil physical requiere evidencia y estado LAB_VALIDATED/PILOT_VALIDATED/CERTIFIED/CONDITIONAL. SIMULATED nunca conduce hardware real. No hay perfiles productivos de muestra ni adaptador simulado en src.
- Automático: `POS_HARDWARE_AUTOMATIC_DRAWER_POLICY_FILE` absoluto, JSON `{schema_version:"1.0.0",binding_id,policy_reference}`. No se configura ninguno en esta entrega. Aprobar topología/protocolo no concede permiso ni valida perfil físico.

## Ejecución observada

Windows, Node 22.19.0, Electron 44.1.1; Docker Linux Node 22 bookworm y Gradle 8.14/JDK17. Salidas conservadas en `artifacts/hardware/2026-10-21/` (ignoradas por git); este informe conserva resultados y comandos reproducibles.

| Verificación | Ejecución / resultado observado | Límite |
|---|---|---|
| Hardware + permisos | `pnpm --filter @pos-platform/pos-local-service exec vitest run tests/hardware.test.ts tests/permission-catalog.test.ts`: 28/28 PASS | Dobles solo en tests, SQLite real temporal, TCP loopback real; Windows prueba cola inexistente, sin impresión |
| Contratos y fronteras IPC | Contratos IPC/permisos: 41 PASS; preload/API/allowlist: 18 PASS; respuestas LocalChannel: 4 PASS | Se actualizan las listas exactas para hardware; se conservan salidas del fallo inicial de esas listas, sin relajar validación |
| Pago → trabajo de cajón | `pnpm --filter @pos-platform/pos-local-service exec vitest run tests/channel-commercial-vertical.test.ts -t 'hardware:'`: 1 PASS / 19 SKIPPED | Canal/handler/pago/SQLite reales, claves de test; no emisión física. Incluye tenant/sucursal ajena, evento inexistente, dedup y rollback por fallo de auditoría |
| SQLite | `pnpm --filter @pos-platform/database-sqlite exec vitest run tests/local-database.test.ts`: 11/11 PASS | No DB persistente |
| Electron → diagnóstico | `powershell -File tools/local/launch-hardware-lab.ps1 -Laboratory -SkipBuild -VerifyAndClose`: exit 0, LAB_VERIFIED | Named pipe/DPAPI/handler/inventario real; SSA de laboratorio. Sin login humano ni impresión |
| Seguridad Electron | sandbox=true, contextIsolation=true, nodeIntegration=false; switch no-sandbox ausente | Inspección runtime, screenshot `electron-hardware.png`, salida `electron-hardware.json` |
| Android | Docker `gradle --no-daemon --max-workers=2 test bridgeAar`: BUILD SUCCESSFUL, 5 tests JVM PASS | AAR compilado contra API Android 9; no APK, SDK/emulador, instalación o prueba USB física |
| Linux | `docker run --rm --mount type=bind,source=C:\Proyectos\pos-platform,target=/work --workdir /work node:22-bookworm node --experimental-strip-types --experimental-transform-types tools/hardware/portable-smoke.mjs`: exit 0 | 10 escrituras TCP loopback y proyección, CUPS_INVENTORY_UNAVAILABLE; no runtime comercial Linux completo |
| Tipos | `pnpm --filter @pos-platform/contracts --filter @pos-platform/database-sqlite --filter @pos-platform/local-channel --filter @pos-platform/pos-local-service --filter @pos-platform/pos-desktop typecheck`: exit 0 | Cinco proyectos afectados, renderer incluido |
| Build / arquitectura | Desktop build exit 0; `node tools/architecture/validate-boundaries.mjs`: ARCH-003 PASS | No equivale a CI del commit ni producción |

Hardware cubre replay/concurrencia de dispatch, persistencia al cerrar/reabrir, recuperación UNKNOWN, fallo de enlace, permisos/motivos, caja fuera de ámbito, rollback de auditoría antes de I/O, comandos/controles inyectados, recibo inexistente/no pagado, exactitud decimal y español sin pulsos, perfil sin corte/pulso y registro confiable ausente.

Se conservan fallos intermedios: fixture Receipt incompleto en TypeScript corregido; esquema de respuesta del canal inicialmente incompleto corregido; primer lanzamiento Electron falló por `ELECTRON_RUN_AS_NODE=1` heredado y se corrigió retirándolo solo del entorno hijo. El primer comando de filtrado Vitest a través de `pnpm test --` **no aplicó `-t` y ejecutó los 20 tests del archivo** (20 PASS); se corrigió a `pnpm exec vitest run ... -t` y el cierre registra 1/19. No se presenta aquella repetición accidental como evidencia nueva. No se corrieron las suites anteriores de contraseña/MFA/sesión.

Artefacto Android: SHA256 `e4cf9a24bcf5bf0cb55860f29e5028f5e05123bd98904e62ca542c68fb0f1238`, `apps/pos-local-service/native/android-hardware/build/outputs/camacho-android-hardware.aar`. No contiene API AOSP ni SDK propietario. Es biblioteca, no instalador. El host/verificador canónico y transporte web seguro siguen faltando. Los cinco tests no ejecutan Binder/UsbManager/SQLite Android; no se declara validado por compilar.

Medición limitada Linux: 10 operaciones/65 ms, RSS 91.226.112 bytes, CPU user 99.317 µs/system 11.769 µs. No es benchmark de negocio ni de Android. No se infiere RAM mínima, batería, thermal throttling ni capacidad de M60WL por estos datos. Registrar cold start, memoria/P95, reconexión y carga en equipo real sigue pendiente.

## Arranque reproducible y bloqueos

Producción: `powershell -File tools/local/launch-windows.ps1 -CheckOnly` → exit 2: faltan las nueve variables de aprovisionamiento (directorio, instalación/dispositivo, versión/rango, tenant/company/branch). No se fabrican valores. El script de producción inicia servicio oculto, espera runtime real y abre Electron sin `--no-sandbox`; limpia el modo Node heredado al abrir Electron y lo restaura después. No se afirma arranque comercial productivo.

Laboratorio visible: `powershell -File tools/local/launch-hardware-lab.ps1 -Laboratory` construye y mantiene abierta una ventana identificada como LABORATORIO; utiliza el host de pruebas existente, SQLite temporal y SSA de test, no visual-preview. Cerrar la ventana detiene su servicio y limpia solo su directorio temporal. No ejecutar en paralelo dos laboratorios con el mismo fixture de instalación.

Inventario read-only: `powershell -File tools/local/diagnose-hardware.ps1`. En este Windows: spooler Running, seis colas virtuales, cero candidatos USB Android/Gprinter, ADB no disponible. No se descargó driver, cambió permisos USB ni autorizó dispositivo. M60WL/GP-L80160/CD350 siguen UNTESTED en la matriz única. El éxito Mharmal es evidencia comunicada por el propietario, no Camacho. Voltaje, pinout, pulso y firmware se verifican antes de permitir una prueba física; no se copia el comando de otra marca.

| Plataforma | Alcance acreditado | Componente que falta |
|---|---|---|
| Windows | Diagnóstico alcanzable desde Electron/servicio/canal real en laboratorio; SQLite y transportes focalizados TESTED | Aprovisionamiento, login real/SSA operacional y pruebas físicas impresora/cajón |
| Android 9 | Biblioteca nativa IMPLEMENTED, compilada y lógica JVM TESTED | Host APK/D8, ABI real, autoridad/verificador y web↔puente seguro, custodia, pruebas físicas y operación autónoma demostrada |
| Linux | Proyección y TCP loopback TESTED | CUPS instalado/equipo, custodia/identidad de cliente y arranque completo, pruebas físicas |

No hay dependencia de ejecutable Windows en el contrato Hardware o la biblioteca Android. El producto completo todavía no acredita compatibilidad Android/Linux. [DEC-025 propuesta](../adr/DEC-025-hardware-portability-proposal.md) delimita la composición pendiente sin crear otro POS ni debilitar el canal Windows.

## Una única solicitud D3 sigue pendiente

Se mantiene sin aprobación el [paquete único de decisiones de acceso comercial](business-access-continuity-2026-10-20.md#solicitud-única-de-aprobación-d3--propuesta-completa-no-aprobada). Los datos del terminal no aprueban ese paquete. Candidatos ya fundamentados allí: navegador externo HTTPS/Code+PKCE S256 y perfil access ligado a DeviceProof; hostname/RP/origin/certificado reales por proporcionar; challenge 120 s, MFA 60 s, código 60 s, access ≤5 min, sesión 8 h/inactividad 15 min y reauth crítica 5 min; refresh rotativo/revocación; abuso 5 fallos/5 min por cuenta y 50/origen con backoff, sujetos a carga y riesgo DoS; custodia y benchmark KDF. **Ninguno se activa como valor productivo.** La fuente normativa, riesgos y aprobación del propietario están en esa tabla, no se reemplazan por un gate nuevo.

Falta componer login central HTTPS → prueba de acceso aprobada → BUSINESS → DeviceProof → reserva persistente 011/012 → autorización vigente/clave operacional → emisor SSA existente → dispositivo → POS Local Service → React. La referencia interna de acceso no cruza procesos ni es token. `file://` del renderer no es el RP WebAuthn. No se habilita endpoint inseguro ni se afirma que una persona real puede ingresar al POS.

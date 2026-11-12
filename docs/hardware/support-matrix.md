# Matriz de soporte y certificación de hardware

## Estado

Marco de certificación aprobado. No existen modelos físicos certificados todavía.

## Propósito

Registrar de manera verificable qué equipos, protocolos, drivers y versiones funcionan con POS Platform. Esta matriz es la fuente de verdad para declaraciones de compatibilidad de hardware.

No se utilizarán afirmaciones como “compatible con cualquier impresora”, “cualquier balanza” o “todos los lectores” sin evidencia por protocolo y equipo.

## Estados

| Estado | Significado |
|---|---|
| `UNTESTED` | Contrato definido, sin prueba física suficiente |
| `SIMULATED` | Adaptador validado únicamente con simulador o fixture |
| `LAB_VALIDATED` | Equipo real probado en laboratorio sobre una matriz limitada |
| `PILOT_VALIDATED` | Equipo real operó en piloto controlado con evidencia |
| `CERTIFIED` | Equipo y combinación de versiones cumplen la suite publicada |
| `CONDITIONAL` | Funciona con limitaciones documentadas |
| `DEPRECATED` | Se mantiene temporalmente; no se recomienda para nuevas instalaciones |
| `UNSUPPORTED` | No cumple contrato, seguridad o estabilidad requerida |

Un estado superior no se infiere. Requiere evidencia y aprobación explícita.

## Matriz inicial

| ID | Tipo | Fabricante/modelo | Conexión/protocolo candidato | Sistema | Estado | Limitación actual |
|---|---|---|---|---|---|---|
| HW-SCN-001 | Lector de códigos | Por seleccionar | USB HID keyboard wedge | Windows 10/11 x64 | `UNTESTED` | Falta equipo físico y prueba de layouts |
| HW-PRN-001 | Impresora térmica | Por seleccionar | ESC/POS mediante spooler o USB | Windows 10/11 x64 | `UNTESTED` | Falta modelo, ancho y prueba de corte |
| HW-DRW-001 | Cajón | Por seleccionar | RJ11/RJ12 controlado por impresora/adaptador | Windows 10/11 x64 | `UNTESTED` | Depende de impresora y pulso configurado |
| HW-SCL-001 | Balanza | Por seleccionar | Serial RS-232 o USB virtual COM | Windows 10/11 x64 | `UNTESTED` | Falta protocolo, baud rate y tramas reales |
| HW-DSP-001 | Pantalla de cliente | Por seleccionar | Serial, USB o segunda pantalla | Windows 10/11 x64 | `UNTESTED` | Capacidad posterior; falta equipo |
| HW-PAY-001 | Datáfono | Depende del adquirente | API/SDK certificado del proveedor | Según proveedor | `UNTESTED` | No existe proveedor ni contrato seleccionado |

Esta tabla identifica familias candidatas, no recomienda comprar un modelo todavía.

## Equipo comunicado por el propietario — 2026-10-21

| ID | Equipo / versión comunicada | Enlace | Estado Camacho | Evidencia y límites |
|---|---|---|---|---|
| HW-TERM-M60WL | M60WL, Android 9, M60WL_V2.01, aproximadamente 4 GB RAM | ADB autorizado por WiFi, ARM64 observado | `UNTESTED` | Certificación del POS completo pendiente. SQLite nativo ya probado en `51d5feb`; prueba del motor Node/better-sqlite3 canónico documentada [aquí](../testing/android-runtime-engine-2026-10-21.md). No acredita sesión, venta ni autorización React |
| HW-PRN-GPL80160 | Gprinter GP-L80160 | USB VID 26728 / PID 1280, interfaz 0, BULK OUT 2 observado | `UNTESTED` | Certificación comercial pendiente. Impresión ASCII propia confirmada por el operador en `b907d20f`; no se repitió. Faltan firmware, CP1252, ancho efectivo, corte y PRINT_RECEIPT autorizado. La ruta USB se redescubre, no se fija `/dev/bus/usb/...` |
| HW-DRW-CD350 | 3nStar CD350 | Recorrido eléctrico exacto sin confirmar | `UNTESTED` | Apertura externa comunicada por el propietario; ninguna apertura Camacho acreditada. Sin revisión, voltaje, pinout ni pulso verificados. Bloqueo explícito de DRAWER_OPEN para ese VID/PID; apertura automática deshabilitada |
| HW-SCL-TEKATLAS-CH340 | TEK ATLAS (denominación reportada), adaptador USB CH340 | VID 6790 / PID 29987; ASCII CRLF, 9600 8N1; Android 9 M60WL | `UNTESTED` **en Camacho POS** | Ensayos físicos externos del puente `co.camachopos.printmini` con Firefox/MásControl: varios pesajes, no sobrescritura, reconexión y botón de permiso tras reinicio informados el 2026-11-06. **No hay adaptación nativa a ventas Camacho POS, ni certificación metrológica.** [Perfil y evidencias](android-m60wl-tek-atlas-ch340-scale.md) |

Mharmal informa un WebSocket en 22300; Camacho **no se conecta a él**, no lo expone ni presupone su autenticación. Quick Printer 1.7.3, Printer y HardwareManager no constituyen integraciones verificadas. El fallo de Más Control/MasPrint Windows en Android no acredita un protocolo alternativo.

La [entrega inicial](../testing/hardware-portability-2026-10-21.md) registró Windows con colas virtuales, Linux TCP loopback y Android AAR/JVM. La continuidad física posterior anterior se registra por capacidad; no transforma esas pruebas parciales en certificación del conjunto ni habilita operaciones eléctricas.

## Registro obligatorio por equipo

Cada fila validada debe conservar:

```text
matrix_id
device_kind
manufacturer
model
hardware_revision
firmware_version
driver_name
driver_version
connection_type
protocol
adapter_id
adapter_version
operating_system
os_build
architecture
tested_at
tested_by
test_suite_version
evidence_reference
status
limitations
```

No se agruparán modelos diferentes solo porque comparten marca comercial.

## Perfil del adaptador

Un adaptador declara:

- identificador y versión;
- tipo de dispositivo;
- protocolos soportados;
- comandos;
- eventos;
- timeouts;
- estrategia de reconexión;
- configuración requerida;
- diagnósticos seguros;
- capacidades opcionales;
- modelos validados;
- licencia y procedencia de dependencias;
- firma o integridad del binario cuando aplique.

Un driver o SDK propietario no se incluye hasta revisar:

- licencia de redistribución;
- mantenimiento;
- arquitectura x64;
- instalación silenciosa o documentada;
- firma del fabricante;
- superficie de red;
- tratamiento de credenciales;
- comportamiento offline;
- actualización y rollback.

## Lector de códigos

### Contrato inicial

- USB HID cuando Windows lo reconozca;
- lectura como secuencia delimitada;
- configuración de sufijo;
- control de longitud;
- soporte para códigos internos y estándares configurados;
- códigos de balanza según perfil;
- prevención de doble lectura accidental;
- independencia del foco cuando el flujo de caja lo requiera;
- captura manual alternativa autorizada.

### Pruebas mínimas

- EAN-13;
- EAN-8;
- UPC cuando aplique;
- Code 128;
- código interno;
- código de balanza;
- lectura rápida repetida;
- caracteres inválidos;
- teclado con layout distinto;
- desconexión y reconexión;
- lector duplicado;
- sufijo faltante;
- foco fuera del campo esperado.

## Impresora térmica

### Contrato inicial

- ESC/POS mediante adaptador;
- cola persistente local;
- ancho configurado por perfil;
- impresión de texto, totales, QR o código cuando aplique;
- corte solo si la capacidad existe;
- apertura de cajón solo mediante comando autorizado;
- reimpresión con la misma identidad de trabajo;
- diagnóstico de spooler y dispositivo;
- ninguna confirmación de venta depende del resultado de impresión.

### Pruebas mínimas

- ticket normal;
- caracteres españoles;
- longitud máxima;
- 58 mm y 80 mm solo cuando el modelo correspondiente exista;
- falta de papel;
- tapa abierta;
- impresora apagada;
- spooler detenido;
- trabajo duplicado;
- reinicio con trabajo pendiente;
- corte disponible/no disponible;
- QR o código ilegible;
- reimpresión sin repetir efectos comerciales.

## Cajón

### Contrato inicial

- apertura ligada a impresora o adaptador certificado;
- pulso configurable por perfil;
- apertura automática según política de cobro;
- apertura manual con permiso y motivo;
- auditoría de toda apertura manual;
- ninguna lectura de “abierto/cerrado” se simula si el equipo no tiene sensor.

### Pruebas mínimas

- apertura después de pago permitido;
- no apertura para método no autorizado;
- apertura manual autorizada;
- rechazo sin permiso;
- impresora desconectada;
- pulso incompatible;
- doble comando;
- auditoría y correlación.

## Balanza

### Contrato inicial

- perfiles por protocolo;
- puerto COM configurable;
- baud rate, bits, paridad, stop bits y terminadores explícitos;
- parser de tramas versionado;
- estabilidad indicada por el dispositivo o política;
- unidad conocida;
- precisión y límites configurados;
- timeout;
- reconexión;
- peso manual alternativo sujeto a permiso y auditoría;
- el adaptador no decide presentación, precio ni impuesto.

### Pruebas mínimas

- peso estable;
- peso inestable;
- cero;
- peso negativo;
- sobrecarga;
- unidad inesperada;
- trama parcial;
- trama corrupta;
- puerto ocupado;
- desconexión durante lectura;
- reconexión;
- dos balanzas configuradas;
- precisión y redondeo comercial separados.

## Pantalla de cliente

La pantalla de cliente es una capacidad posterior y no bloquea el núcleo. Cuando se implemente debe:

- recibir una proyección sanitizada;
- no acceder a SQLite;
- no exponer costos, permisos ni datos innecesarios;
- limpiar datos entre ventas;
- funcionar sin modificar el estado de la venta;
- degradar sin impedir cobro.

## Datáfono

No existe un adaptador genérico de datáfono independiente del adquirente.

Cada integración requiere:

- proveedor y contrato;
- SDK/API oficial;
- certificación requerida;
- idempotencia;
- estados de pago;
- reversals y refunds;
- timeouts inciertos;
- conciliación;
- seguridad y alcance PCI aplicable;
- pruebas con terminal real.

La captura manual de una referencia no se presenta como integración certificada.

## Simuladores

Se crearán simuladores contractuales para:

- lector HID;
- impresora;
- cajón;
- balanza;
- fallos y timeouts.

Los simuladores:

- ejecutan los mismos contratos que los adaptadores;
- producen estados deterministas;
- permiten inyectar errores;
- no cambian una fila a `LAB_VALIDATED` o `CERTIFIED`;
- no reemplazan pruebas de drivers, firmware, señal eléctrica o spooler.

## Laboratorio

El laboratorio conserva:

- inventario físico de equipos;
- cables, adaptadores y fuentes usados;
- equipo Windows de referencia bajo y recomendado;
- versiones de sistema y drivers;
- fixtures de códigos y tickets;
- pesos patrón apropiados;
- evidencias de prueba;
- procedimiento de limpieza y restablecimiento;
- registro de fallos reproducibles.

No se usan datos reales de clientes.

## Proceso de certificación

1. Seleccionar modelo y obtener documentación oficial.
2. Revisar protocolo, drivers y licencia.
3. Registrar fila `UNTESTED`.
4. Implementar o configurar adaptador.
5. Pasar suite con simulador y marcar `SIMULATED`.
6. Ejecutar suite física en Windows soportado.
7. Registrar firmware, drivers y evidencia.
8. Corregir fallos y repetir suite completa.
9. Marcar `LAB_VALIDATED` si cumple laboratorio.
10. Ejecutar piloto controlado.
11. Marcar `PILOT_VALIDATED` o `CONDITIONAL`.
12. Autorizar `CERTIFIED` solo con criterios publicados y soporte definido.

Una actualización de firmware, driver, adaptador o sistema operativo puede exigir recertificación.

## Criterios para declarar compatibilidad

Una combinación solo se publica como compatible cuando:

- fabricante y modelo son exactos;
- conexión y protocolo están definidos;
- existe adaptador versionado;
- suite física pasó;
- limitaciones están documentadas;
- instalación es reproducible;
- fallos no corrompen operaciones;
- existe diagnóstico;
- seguridad y licencia fueron revisadas;
- evidencia es localizable.

## Criterio para iniciar `DEV-003`

`DEV-003` puede comenzar con simuladores y contratos. No puede declarar compatibilidad comercial hasta disponer de al menos un equipo físico seleccionado por cada capacidad que se pretenda vender y alcanzar `LAB_VALIDATED`.

## Próxima evidencia requerida

Antes de comprar o implementar adaptadores específicos se requiere registrar:

- modelos disponibles o candidatos del lector;
- impresora térmica objetivo;
- cajón compatible con esa impresora;
- balanza y protocolo documentado;
- proveedor de datáfono si se incluye en el alcance inicial;
- equipos Windows de referencia.

La ausencia actual de modelos no bloquea `TECH-002`; bloquea certificación de hardware y la salida comercial de `DEV-003`.

# DEC-025 — Composición de hardware y portabilidad del host

Estado: **PROPUESTA; pendiente decisión del propietario**. Fecha: 2026-10-21.

Se continúa DEC-017 (owner Hardware dentro del POS Local Service) y DEC-019 (recibo como proyección). Esta propuesta no autoriza un segundo motor de ventas, pagos, autenticación, SQLite comercial ni sincronización.

El incremento implementa contratos versionados, cola y auditoría en el writer SQLite existente, transportes TCP/spooler/CUPS y una biblioteca nativa USB Android. Renderer expresa intención; el servicio deriva identidad/ámbito de SSA y evalúa permisos. No hay socket de hardware abierto en LAN, bytes eléctricos del cliente ni integración con Mharmal.

La biblioteca Android no es un POS autónomo. Su SQLite privado conserva únicamente deduplicación de ejecución física. Debe recibir autoridad validada por un host canónico; el servicio no exportado rechaza ejecución sin ese host. Android USB requiere permiso OS y un perfil VID/PID/interfaz/endpoint explícito ([documentación Android](https://developer.android.com/develop/connectivity/usb/host)). Compilar contra Android 9 no demuestra disponibilidad USB ni ejecución en M60WL.

Decisión de composición pendiente: mantener un único POS Local Service comercial y definir el transporte autenticado hacia el host Android. Un terminal web con servicio en la LAN puede funcionar sin Internet, pero depende de esa LAN y no acredita operación autónoma del terminal. Embutir el motor TypeScript/SQLite existente en Android requiere una prueba de runtime/ABI, custodia y single-writer; no se selecciona ni implementa otro motor como atajo. Un navegador arbitrario no obtiene acceso al Binder nativo.

El host Linux requiere resolver custodia de claves y autenticación del cliente por el contrato existente antes de levantar un runtime productivo. No se exporta el proveedor inseguro de tests, no se desactiva la validación Windows y no se considera que TCP loopback certifique Linux completo.

Se propone aprobar por separado de la política D3 ya solicitada: topología Android (servicio local en terminal o servicio LAN), origen HTTPS permitido, emparejamiento y prueba de posesión con ciclo de revocación, protocolo/versiones y distribución/actualización del host nativo. El análisis se entrega para decisión; no activa red, credenciales ni permisos. Bluetooth/SPP/BLE/serial y SDK propietarios permanecen pendientes de equipos y contratos específicos.

Consecuencia actual: Windows alcanza diagnóstico desde Electron en laboratorio; no hay login comercial. Android entrega AAR, no APK ni integración web utilizable. Linux entrega piezas de transporte probadas parcialmente, no despliegue certificado. El objetivo multiplataforma y las pruebas físicas siguen abiertos.

## Continuidad autorizada de laboratorio — 2026-10-21

El propietario solicitó expresamente completar el host Android mínimo, APK, autorización confiable, descubrimiento, perfiles y transporte seguro para pruebas físicas M60WL/GP-L80160/CD350 desde `1674296c`. Esta autorización concreta permite el host **de pruebas físicas**, sin aprobar por inferencia una topología comercial, login, servicio LAN o protocolo web productivo de esta propuesta.

Se reutiliza la biblioteca y su AAR con un host nativo dentro del mismo owner. Se entrega transporte documental firmado fuera de red: clave pública de laboratorio fijada en el APK, órdenes P-256 de uso único y duración explícita, binding a clave local de app/nonce/descriptores USB, permiso Android y revisión física nativa antes del envío. No hay servidor, WebView ni puente para páginas arbitrarias. Los bytes se construyen en código a partir de un perfil técnico revisado; no se importan comandos crudos. La autoridad de laboratorio no concede roles, sesiones BUSINESS ni SSA. El ledger privado existente se conserva.

La instalación de esta app crea únicamente material propio del laboratorio en su sandbox/Keystore y en el kit aislado del técnico. No se altera ninguna credencial comercial ni se reutilizan sus claves. La clave de órdenes no se empaqueta en APK/Git. Revocar/desarmar bloquea intentos posteriores; no puede deshacer una escritura física ya iniciada. La matriz de certificación permanece `UNTESTED` hasta observar las pruebas físicas suficientes. [Procedimiento reproducible](../hardware/android-m60wl-lab-runbook.md).

El estado histórico anterior de AAR sin host se conserva como evidencia de `1674296c`; el resultado nuevo del empaquetado y sus límites se registran en el [informe del host](../testing/android-hardware-host-2026-10-21.md). La propuesta comercial general de este ADR sigue pendiente.

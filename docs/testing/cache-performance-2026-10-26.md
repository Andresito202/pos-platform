# Cierre focalizado: limitador y caché HTTP

Continuidad 7da8d97e, sin cambios de diseño ni reconstrucción de login.

Defectos demostrados: el handler HTTP comercial retenía una entrada Map por
dirección sin límite ni expiración de direcciones abandonadas. El limitador
general, ya acotado, expulsaba una entrada activa al llenar capacidad, lo que
permitía reiniciar su presupuesto mediante rotación de claves/direcciones.

Ahora ambos reutilizan FixedWindowRateLimiter: límite de cardinalidad, rechazo
de claves nuevas al saturarse, conservación de presupuestos activos, rechazo de
retroceso temporal y mantenimiento de entradas únicamente vencidas. La limpieza
automática ocurre al avanzar la ventana; pruneExpired es el mantenimiento interno
manual y no permite borrar presupuestos vigentes. Central comercial requiere
limits.http_maximum_buckets explícito, sin valor productivo inventado.

Medición controlada de 100.000 claves: caché anterior retiene 100.000 entradas;
nueva, con capacidad de prueba 1.000, retiene 1.000 y conserva el bloqueo de la
primera clave. Es reducción de entradas retenidas (99%), no medición de RSS ni
promesa de velocidad global del POS. No se ejecuta carga contra Central auténtico.

Chromium: BrowserCacheMaintenance opera exclusivamente getCacheSize/clearCache.
Se configura opcionalmente en el archivo público Desktop mediante browser_cache:
maximum_cache_bytes e interval_ms explícitos. Sobre umbral limpia automáticamente;
menú nativo Mantenimiento permite limpieza manual y muestra bytes observados.
Coalesce trabajo concurrente, detiene timer y reporta errores; no elimina cookies,
localStorage, SQLite, outbox, auditoría, SSA/SAS, watermarks ni DPAPI.

Electron real Windows, perfil temporal independiente, caché HTTP real de prueba:
2.097.408 bytes antes, 0 después; 52,8336 ms. Cookie de estado independiente
conservada. Informe browser-cache-physical.json. No fue un perfil comercial ni
una certificación de login. No se modificó el servicio Windows instalado.

Validación observada:

- rate-cache-final.json: 6 PASS, 0 FAIL (dos casos nuevos y regresión directa).
- browser-cache-unit.json: 4 PASS, 0 FAIL; esos cuatro están incluidos en
  cache-main-final.json: 20 PASS, 0 FAIL; no sumarlos dos veces.
- cache-http-regression.json: 1 PASS, 0 FAIL, sólo integración directamente afectada.
- Playwright browser-cache.spec.ts: 1 PASS, 0 FAIL, Electron físico descrito arriba.
- TypeScript afectados, build Desktop, arquitectura/política local: PASS.
  Nx reutilizó caché en una ejecución; no confundir esa salida con una ejecución
  nueva del validador. La verificación final directa se registra en la evidencia.

Fallo inicial de regresión: el test buscaba SESSION_TRUST_UNAUTHORIZED literal,
pero main ya componía el código con prefix. Se corrigió la aserción al contrato
vigente manteniendo la comprobación de orden rate-limit antes de bearer.

Este cierre no afirma que toda lentitud del producto esté resuelta. No se
encontró evidencia que justifique borrar datos comerciales, aplicar VACUUM
productivo, limpiar archivos ajenos o cambiar consultas de módulos no afectados.
Mantenimiento SQLite/archivos o perfiles de rendimiento adicionales requieren
un problema reproducible y medición propia; no se inventan optimizaciones.

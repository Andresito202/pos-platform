# Requisitos no funcionales

## Rendimiento

RNF-PER-001. Agregar un producto escaneado al carrito debe tardar menos de 1 segundo en condiciones normales.

RNF-PER-002. Confirmar una venta local debe tardar menos de 2 segundos, excluyendo impresión y servicios externos.

RNF-PER-003. La búsqueda de productos debe responder en menos de 500 ms para catálogos de hasta 100.000 variantes bajo condiciones de referencia.

RNF-PER-004. El POS debe iniciar en menos de 10 segundos en el hardware mínimo soportado.

RNF-PER-005. Los reportes pesados no deben bloquear operaciones del POS.

RNF-PER-006. El dashboard conectado debe reflejar una venta en menos de 5 segundos en condiciones normales.

## Disponibilidad

RNF-AVL-001. El POS híbrido debe continuar ventas ordinarias durante una interrupción de Internet.

RNF-AVL-002. La caída de impresión no debe impedir confirmar una venta.

RNF-AVL-003. La caída de facturación electrónica no debe perder la venta comercial.

RNF-AVL-004. El sistema debe recuperarse de cierres inesperados sin duplicar operaciones confirmadas.

RNF-AVL-005. Una actualización fallida debe permitir rollback seguro.

## Integridad

RNF-INT-001. No se permitirá pérdida de una venta confirmada.

RNF-INT-002. No se permitirán ventas duplicadas por reintento o doble clic.

RNF-INT-003. Venta, pagos, inventario, caja y auditoría deben conservar consistencia transaccional.

RNF-INT-004. Los movimientos históricos no deben eliminarse físicamente.

RNF-INT-005. Los cálculos monetarios deben usar tipos decimales exactos.

RNF-INT-006. Las cantidades pesables deben conservar precisión definida por unidad.

## Seguridad

RNF-SEC-001. Toda autorización debe validarse en backend.

RNF-SEC-002. Debe existir aislamiento probado entre tenants.

RNF-SEC-003. Propietarios y administradores críticos deben usar MFA.

RNF-SEC-004. Los tokens de acceso deben ser de corta duración y revocables.

RNF-SEC-005. Los secretos no deben almacenarse en código ni frontend.

RNF-SEC-006. Los cambios de QR, cuentas, NIT, propietario, correo o teléfono deben exigir reautenticación.

RNF-SEC-007. Deben existir controles contra fuerza bruta, enumeración, IDOR, BOLA, inyección y abuso de API.

RNF-SEC-008. Los logs no deben exponer contraseñas, tokens completos ni secretos.

RNF-SEC-009. Las actualizaciones y licencias deben estar firmadas.

RNF-SEC-010. Toda operación crítica debe registrar auditoría.

## Usabilidad

RNF-UX-001. El cajero debe completar una venta común sin entrar a módulos administrativos.

RNF-UX-002. La interfaz debe funcionar con teclado, mouse, lector y pantalla táctil.

RNF-UX-003. Los controles frecuentes deben cumplir tamaños táctiles adecuados.

RNF-UX-004. Los estados de conexión, caja, impresora y balanza deben ser visibles y compactos.

RNF-UX-005. No deben existir cargas indefinidas sin estado explicativo.

RNF-UX-006. Los módulos no habilitados no deben saturar la navegación operativa.

RNF-UX-007. La aplicación debe cumplir criterios de accesibilidad equivalentes a WCAG 2.2 AA en las interfaces web aplicables.

## Escalabilidad

RNF-SCL-001. La arquitectura debe soportar crecimiento de empresas, sucursales, cajas, usuarios, productos y ventas sin rediseñar el núcleo.

RNF-SCL-002. El sistema debe soportar múltiples cajas concurrentes por sucursal.

RNF-SCL-003. Los procesos de reportes y notificaciones deben poder ejecutarse de forma asíncrona.

RNF-SCL-004. Los módulos solo se extraerán a servicios independientes cuando exista necesidad técnica demostrada.

## Mantenibilidad

RNF-MNT-001. El backend debe conservar límites modulares explícitos.

RNF-MNT-002. La lógica de negocio no debe residir directamente en controladores HTTP ni componentes visuales.

RNF-MNT-003. Cada módulo debe documentar contratos, eventos, permisos y pruebas.

RNF-MNT-004. Las migraciones deben versionarse y validarse en CI.

RNF-MNT-005. No se aceptarán dependencias sin mantenimiento o sin licencia compatible.

RNF-MNT-006. Los cambios críticos deben contar con pruebas de regresión.

## Compatibilidad

RNF-CMP-001. El POS inicial debe soportar Windows 10 y 11 de 64 bits.

RNF-CMP-002. Los lectores USB HID deben funcionar sin drivers propietarios cuando el sistema operativo los reconozca.

RNF-CMP-003. Las impresoras térmicas compatibles con ESC/POS deben integrarse mediante adaptadores.

RNF-CMP-004. Las balanzas deben integrarse por perfiles y protocolos configurables.

RNF-CMP-005. El diseño debe adaptarse a resoluciones y tamaños de pantalla definidos en una matriz de soporte.

## Respaldo y recuperación

RNF-BKP-001. La modalidad híbrida debe ejecutar backups automáticos de datos centrales.

RNF-BKP-002. La modalidad local perpetua debe disponer de backup local configurable.

RNF-BKP-003. Los backups deben probarse mediante restauraciones periódicas.

RNF-BKP-004. Deben definirse RPO y RTO por modalidad.

RNF-BKP-005. El sistema debe documentar recuperación por pérdida o cambio de dispositivo.

## Observabilidad

RNF-OBS-001. El sistema debe registrar errores estructurados con correlación.

RNF-OBS-002. Debe registrar versión, dispositivo, tenant y sucursal cuando corresponda.

RNF-OBS-003. Debe monitorear fallos de sincronización, impresión, hardware, backups y actualizaciones.

RNF-OBS-004. El soporte debe poder diagnosticar sin acceso directo e ilimitado a datos comerciales.

## Privacidad

RNF-PRV-001. La geolocalización del domiciliario solo se recopilará durante operaciones autorizadas.

RNF-PRV-002. Los datos personales deben tener finalidad, retención y control de acceso definidos.

RNF-PRV-003. El acceso de soporte a datos del cliente debe ser temporal y auditado.

RNF-PRV-004. Debe existir proceso de exportación, retención y eliminación al terminar el servicio.

## Calidad

RNF-QLT-001. Cada pull request debe pasar lint, tipos, pruebas y validación de migraciones.

RNF-QLT-002. Las funciones críticas requieren pruebas positivas, negativas y de permisos.

RNF-QLT-003. La cobertura no sustituye pruebas de comportamiento y concurrencia.

RNF-QLT-004. No se desplegarán cambios críticos con pruebas fallidas.

## Objetivos pendientes de benchmark

Los siguientes valores deberán confirmarse con pruebas reales antes de convertirse en SLA contractual:

- volumen máximo por caja;
- cajas concurrentes por sucursal;
- ventas por minuto;
- tamaño máximo de catálogo;
- retención de auditoría;
- RPO;
- RTO;
- tiempo máximo de sincronización.

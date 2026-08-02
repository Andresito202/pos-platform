# Estrategia de pruebas

## Objetivo

Garantizar que las funciones críticas del POS sean correctas, seguras, recuperables y resistentes a fallos.

## Pirámide de pruebas

### Pruebas unitarias

Validan reglas aisladas:

- cálculo de subtotal;
- impuestos;
- descuentos;
- cambio;
- costo promedio;
- conversión de unidades;
- peso;
- FEFO;
- FIFO;
- límites de crédito;
- efectivo esperado;
- estados de licencia;
- permisos.

### Pruebas de integración

Validan módulos y persistencia:

- venta con inventario;
- venta con caja;
- compra con recepción;
- devolución;
- anulación;
- cierre de caja;
- multiempresa;
- multisucursal;
- sincronización;
- auditoría;
- licencia;
- dispositivo.

### Pruebas E2E

Validan flujos completos:

- iniciar sesión;
- abrir caja;
- registrar venta;
- cobrar;
- imprimir;
- suspender venta;
- recuperar venta;
- devolver;
- cerrar caja;
- consultar dashboard;
- registrar compra;
- recibir inventario.

### Pruebas de contrato

Validan compatibilidad entre:

- POS y API;
- panel del propietario y API;
- app del domiciliario y API;
- app del comprador y API;
- hardware agent y POS;
- sincronización local y backend.

## Seguridad

Se deben probar como mínimo:

- acceso entre tenants;
- acceso entre sucursales;
- manipulación de identificadores;
- escalamiento de privilegios;
- cambio no autorizado de precios;
- modificación no autorizada de QR;
- acceso a costos por cajero;
- reutilización de tokens;
- fuerza bruta;
- expiración de sesión;
- revocación de dispositivo;
- IDOR;
- BOLA;
- inyección;
- payloads inválidos;
- exportación no autorizada.

## Integridad transaccional

Casos obligatorios:

1. Venta confirmada con todos sus efectos.
2. Fallo antes del commit.
3. Fallo después de guardar venta, pero antes de imprimir.
4. Doble clic en cobrar.
5. Reintento de red.
6. Operación repetida con misma idempotency key.
7. Falta de stock durante concurrencia.
8. Reinicio del equipo durante una venta.
9. Sincronización duplicada.
10. Conflicto de precio.

## Offline y sincronización

Probar:

- venta sin Internet;
- recuperación de conexión;
- cola pendiente;
- eventos fuera de orden;
- reintentos;
- duplicados;
- dispositivo con hora incorrecta;
- sincronización parcial;
- servidor temporalmente caído;
- conflicto entre sucursales;
- restauración de cola.

## Hardware

Probar con simuladores y dispositivos reales:

- lector USB HID;
- impresora ESC/POS;
- impresora desconectada;
- falta de papel;
- cajón sin respuesta;
- balanza serial;
- balanza inestable;
- puerto COM incorrecto;
- desconexión durante lectura.

## Rendimiento

Objetivos iniciales:

- agregar producto: menos de 1 segundo;
- confirmar venta local: menos de 2 segundos;
- búsqueda de producto: respuesta perceptiblemente inmediata;
- arranque del POS: menos de 10 segundos;
- actualización del dashboard: pocos segundos con conexión;
- reportes pesados: no bloquear el POS.

## Datos de prueba

Se utilizarán:

- fixtures deterministas;
- factories;
- bases aisladas;
- datos sintéticos;
- tenants separados;
- productos unitarios y pesables;
- lotes vencidos y vigentes;
- cajas abiertas y cerradas.

No se usarán datos reales de clientes en pruebas.

## Cobertura

La cobertura no será el único indicador.

Las áreas críticas deben tener:

- pruebas positivas;
- pruebas negativas;
- pruebas de permisos;
- pruebas de concurrencia;
- pruebas de recuperación.

## CI

Cada pull request deberá ejecutar:

- lint;
- type checking;
- unit tests;
- integration tests;
- security checks;
- dependency audit;
- migration validation.

No se permitirá fusionar cambios críticos con pruebas fallidas.

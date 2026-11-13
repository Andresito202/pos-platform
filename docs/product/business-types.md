# Tipos de comercio

La plataforma utilizará un núcleo universal con módulos especializados. No se crearán repositorios ni versiones independientes por sector.

## Comercios prioritarios

- Tiendas de barrio.
- Minimercados.
- Supermercados pequeños y medianos.
- Comercios de alimentos perecederos y venta por peso.
- Carnicerías.
- Fruver, fruterías y verdulerías.
- Cacharrerías y almacenes de variedades.
- Papelerías.
- Depósitos de bebidas.
- Licoreras.

## Comercios previstos mediante módulos especializados

- Droguerías.
- Ferreterías.
- Almacenes de ropa.
- Almacenes de calzado.
- Panaderías.
- Tiendas de mascotas.
- Tiendas de productos de aseo.
- Negocios de alimentos preparados.

## Capacidades por sector

### Comercios de alimentos perecederos y carnicerías

- venta por peso;
- lotes;
- vencimientos;
- despiece;
- transformación;
- merma;
- trazabilidad.

### Fruver

- catálogo visual;
- venta por peso;
- balanza;
- productos perecederos;
- merma;
- alertas.

### Tiendas y supermercados

- código de barras;
- múltiples presentaciones;
- inventario;
- compras;
- caja;
- crédito;
- promociones;
- multisucursal.

### Droguerías

- lotes obligatorios;
- vencimientos estrictos;
- laboratorio;
- principio activo;
- concentración;
- presentación;
- registro sanitario;
- trazabilidad reforzada.

La droguería deberá validarse en una fase especializada debido a sus requisitos regulatorios.

### Cacharrerías y almacenes de variedades

- múltiples categorías;
- referencias;
- colores;
- tamaños;
- modelos;
- precios mayoristas y minoristas.

### Ferreterías

- unidades;
- metros;
- kilogramos;
- cajas;
- conversiones;
- referencias técnicas;
- precios por volumen.

## Regla de interfaz

Cada negocio verá únicamente las funciones, categorías y módulos relevantes para su operación.


## Materialización revisada — 2026-11-13

Solicitud del propietario: priorizar fruver, avícola, droguería y pastelería en la línea activa existente. La especialización de droguería deja de ser un trabajo diferido; esto cambia la prioridad, no acredita su implementación.

Auditoría del runtime: `SqliteInventoryStore` mantiene movimientos, saldo por presentación/sucursal, auditoría y outbox. `ReceiveStockUseCase` y `AdjustStockUseCase` controlan permisos diferentes; ventas calcula con la precisión de la presentación. Los contratos de lotes/FEFO y recepción extendida existen en UC-INVENTORY-001/002 y los modelos físicos; no hay todavía una cadena operativa completa que los aplique. `receipt-quantities.ts` calcula conversiones exactas, pero no registra una recepción convertida: no confundir esa función con una capacidad disponible al usuario.

| Sector | Base reutilizable | Falta en la cadena operativa |
|---|---|---|
| Fruver | Catálogo visual, cantidades fraccionarias, merma con motivo y saldo | Lote de recepción, vida útil, rotación/alertas, tara y verificación de balanza en dispositivo |
| Avícola minorista | Venta por peso y por unidades, entradas y mermas | Trazabilidad del lote/proveedor, conservación, despiece con rendimientos y pérdidas; conversión de empaques sin doble existencia |
| Droguería | Catálogo, código de barras, venta por presentación | Lote obligatorio, vencimiento/FEFO y bloqueo de vencidos, retiro/cuarentena, laboratorio/principio activo/concentración/registro sanitario, dispensación según categoría |
| Pastelería | Venta de producto terminado y materias primas como presentaciones | Recetas versionadas, consumo de ingredientes, producción de lotes, rendimiento/costo y merma; trazabilidad ingrediente→producto terminado y vencimientos |

Avícola se interpreta aquí como expendio y transformación minorista de productos avícolas, no como software de granja o planta de sacrificio. Pastelería incluye elaboración; revender tortas como productos terminados no demuestra control de producción.

### Integridad común implementada en este incremento

- Recepción y ajuste verifican la precisión publicada de la presentación: unidades enteras no aceptan fracciones; peso admite solamente los decimales configurados.
- Cantidad positiva, escala y rango exactos; no redondear ni truncar entradas. Rechazar desbordamiento del saldo antes de escribir.
- Presentación y lecturas de stock bajo tenant/empresa/sucursal. Ningún perfil comercial autoriza cruces de empresa.
- Rechazos no producen movimiento; repetición de la misma operación confirmada conserva idempotencia.
- Se conserva un único escritor de stock, auditoría y outbox. No se han creado cuatro inventarios aislados ni cuatro aplicaciones.

### Roles y sincronización: contrato de implementación pendiente

- Superadministrador: habilita capacidades y licencias por empresa/dispositivo mediante autoridad GLOBAL. No escribe saldos comerciales saltando el contexto de la empresa.
- Administrador: configura catálogo, unidades, lotes, recetas y cajas dentro de su ámbito; consulta resultados. Los permisos de nuevas operaciones deben existir tanto en autoridad como en servicio.
- Supervisor: consulta y aprueba únicamente operaciones delegadas. Sin venta ni carrito.
- Cajero: vende bajo las restricciones del producto y el turno; no cambia reglas, saldos, lotes ni licencias.
- Los roles consultan el mismo estado autorizado; no replican tablas por rol.
- La sincronización entre dispositivos requiere confirmar aplicación central, proyección de retorno, deduplicación y conflictos de lotes/stock. Existencia de outbox local no acredita ese recorrido ni actualización en tiempo real.

### Continuación sobre owners existentes

1. Extender recepción y ciclo de inventario de UC-INVENTORY-001/002, con modelos físicos existentes, hacia lote/vencimiento y consumo rastreable. Migraciones aditivas; conservar saldos y movimientos históricos.
2. Publicar política sectorial y permisos por empresa con versión, habilitación GLOBAL y proyección local; no usar un selector local como autorización.
3. Implementar transformación/despiece y receta/producción mediante movimientos atómicos de consumo y salida, no conversiones que creen mercancía sin consumir insumos.
4. Conectar las pantallas actuales y plantillas de carga a esos contratos; rechazar cargas incompletas por lote/unidad/empresa.
5. Probar venta por peso, merma, vencidos, retirada de lote, receta, repetición offline y sincronización. Verificar por cada rol, empresa y plataforma.

Estas son brechas abiertas en el backlog existente, no funciones acreditadas. No se habilita droguería como producto especializado listo para operar con este incremento.

### Fuentes primarias consultadas el 2026-11-13

- [INVIMA: Resolución 2674 de 2013](https://normograma.invima.gov.co/normograma/compilacion/docs/resolucion_minsaludps_2674_2013.htm): identificación y control de materias primas, almacenamiento, rotación y conservación de alimentos. Se usa para derivar requisitos de trazabilidad; no representa certificación sanitaria del software.
- [INVIMA: Resolución 1403 de 2007](https://normograma.invima.gov.co/compilacion/docs/resolucion_minproteccion_1403_2007.htm): recepción de medicamentos con lote, vencimiento y registro sanitario; control de fechas y retiros.
- [INVIMA: guía de trazabilidad](https://www.invima.gov.co/biblioteca/download/144296): registro de recepciones e identificación de lotes en la cadena alimentaria. Los requisitos de una planta no se trasladan automáticamente a un expendio minorista.


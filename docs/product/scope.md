# Alcance inicial

## Incluido en el núcleo profesional

- autenticación;
- empresas;
- sucursales;
- usuarios;
- roles y permisos;
- dispositivos;
- licencias;
- catálogo;
- categorías;
- códigos de barras;
- unidades de medida;
- precios versionados;
- inventario;
- lotes;
- vencimientos;
- compras;
- proveedores;
- caja;
- ventas;
- pagos;
- devoluciones;
- auditoría;
- impresión;
- balanza manual y automática;
- importación masiva;
- panel del propietario;
- soporte;
- modalidades híbrida y local perpetua.

## Previsto para fases posteriores

- domicilios;
- aplicación del comprador;
- aplicación del domiciliario;
- seguimiento GPS;
- facturación electrónica;
- QR dinámico;
- conciliación bancaria;
- producción y recetas;
- integraciones avanzadas.

Estas funciones se aplazan por alcance, no porque la arquitectura las ignore.

## Fundación transversal aprobada antes de implementación

Aunque su entrega comercial pertenezca a fases posteriores, la fundación ya define:

- stack TypeScript, NestJS, Electron/React y servicio local;
- PostgreSQL central y SQLite/WAL local;
- infraestructura productiva pagada;
- modalidades `HYBRID` y `LOCAL_PERPETUAL`;
- contratos POS, API, hardware y proveedores externos;
- arquitectura neutral de documentos electrónicos;
- Factus como primer adaptador sandbox y Siigo como segunda validación de neutralidad;
- matriz de certificación de hardware;
- gestión de secretos, firma, backups y soporte temporal.

Definir el contrato no significa que la capacidad esté implementada, certificada o habilitada en producción.

## Límites del núcleo inicial

- La PWA del POS es laboratorio con datos sintéticos; `IndexedDB`, `sql.js` o SQLite/WASM no se usan como persistencia productiva. El runtime físico será Electron más POS Local Service.
- Un cliente `LOCAL_PERPETUAL` opera el núcleo sin backend central ni proveedor fiscal.
- Facturación electrónica solo se habilita con configuración, proveedor y validación aplicables.
- Ningún ticket se presenta como factura electrónica sin evidencia fiscal válida.
- Piloto y producción no usan bases, servicios ni almacenamiento gratuitos.

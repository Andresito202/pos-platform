# Manual de Usuario - Supermercado Avicola

**Version:** 1.0
**Fecha:** 2026-03-09
**Autor:** Wilson Andres Camacho Culma

---

## 1. Requisitos previos

- Docker Desktop instalado y en ejecucion
- Navegador web moderno (Chrome, Firefox, Edge)
- Puertos 8000 y 5432 disponibles

---

## 2. Instalacion y arranque

### Con Docker (recomendado)
1. Abrir Docker Desktop y esperar que inicie
2. Doble clic en `iniciar.bat`
3. Esperar a que aparezca el mensaje "Application startup complete"
4. Abrir el navegador en **http://localhost:8000**

### Sin Docker
```bash
cd backend
pip install -r requirements.txt
# Configurar DATABASE_URL en .env apuntando a PostgreSQL local
uvicorn app.main:app --reload --port 8000
```

### Detener el sistema
- Doble clic en `detener.bat`
- O ejecutar: `docker-compose -f infra/docker-compose.yml down`

---

## 3. Primer acceso

### Credenciales por defecto
| Usuario | Contrasena | Rol |
|---|---|---|
| admin | ******** | Administrador |

### Usuarios del seed (si se ejecuto seed_data.py)
| Usuario | Contrasena | Rol |
|---|---|---|
| admin | ******** | Administrador |
| cajero1 | ******** | Cajero |
| bodeguero1 | ******** | Bodeguero |
| supervisor1 | ******** | Supervisor |
| gerente1 | ******** | Gerente |

### Proceso de login
1. Abrir http://localhost:8000/login.html
2. Copiar las credenciales desde la seccion demo o ingresar usuario y contrasena manualmente
3. Hacer clic en "Iniciar Sesion"
4. El sistema redirige al Dashboard

---

## 4. Dashboard (Pagina principal)

Al ingresar se muestra un resumen con:
- **Tarjetas de resumen:** Total ventas del dia, productos registrados, alertas de stock bajo, lotes proximos a vencer
- **Navegacion lateral:** Menu con acceso a todos los modulos segun el rol del usuario

---

## 5. Modulos del sistema

### 5.1 Categorias
**Ruta:** Menu lateral > Categorias

- **Crear:** Boton "Nueva Categoria" > Escribir nombre y descripcion > Guardar
- **Editar:** Clic en icono de edicion en la fila de la categoria
- **Desactivar:** Clic en icono de eliminar (soft delete, no se borra de la base de datos)
- Las categorias desactivadas no aparecen en los selectores de producto

### 5.2 Productos
**Ruta:** Menu lateral > Productos

- **Crear:** Boton "Nuevo Producto" > Completar todos los campos:
  - Codigo (unico, ej: P001)
  - Nombre
  - Categoria (selector)
  - Precio de compra y precio de venta
  - Unidad de medida (unidad, kilogramo, libra, gramo, litro)
  - Stock minimo (para alertas)
  - Marcar si es perecedero
- **Buscar:** Usar el campo de busqueda por nombre o codigo
- **Filtrar:** Por categoria, solo activos, solo perecederos

### 5.3 Proveedores
**Ruta:** Menu lateral > Proveedores

- **Crear:** Boton "Nuevo Proveedor" > Completar NIT (unico), nombre, contacto, telefono, email, direccion
- **Buscar:** Por nombre o NIT
- **Editar/Desactivar:** Iconos en cada fila

### 5.4 Compras
**Ruta:** Menu lateral > Compras

- **Registrar compra:**
  1. Seleccionar proveedor
  2. Agregar productos con boton "+" (seleccionar producto, cantidad, costo unitario)
  3. Se pueden agregar multiples lineas de detalle
  4. El total se calcula automaticamente
  5. Clic en "Guardar Compra"
- **Efecto automatico:** Al guardar una compra se generan:
  - Lotes con codigo automatico (LOT-{compra_id}-{producto_id})
  - Movimientos de entrada en inventario
- **Anular:** Solo admin/supervisor pueden anular. Revierte el stock

### 5.5 Inventario
**Ruta:** Menu lateral > Inventario

Tiene 4 pestanas:

- **Stock actual:** Tabla con stock por producto, alerta visual cuando esta por debajo del minimo
- **Lotes:** Lista de lotes con cantidad disponible, fecha de ingreso y vencimiento
- **Movimientos:** Historial de todas las entradas, salidas, ajustes, mermas y devoluciones
- **Alertas vencimiento:** Lotes que vencen en los proximos dias (configurable)

- **Ajuste manual:** Boton para ajustar stock (+/-) con observacion obligatoria. Solo admin/supervisor/bodeguero

### 5.6 Punto de Venta (POS)
**Ruta:** Menu lateral > POS

1. **Buscar producto:** Escribir nombre o codigo en el buscador
2. **Agregar al carrito:** Clic en el producto, ajustar cantidad
3. **Seleccionar metodo de pago:** Efectivo, tarjeta, transferencia o mixto
4. **Seleccionar cliente** (opcional): Buscar por documento o nombre
5. **Completar venta:** Clic en "Finalizar Venta"
6. **Efecto automatico:**
   - Se descuenta stock por FIFO (lote mas antiguo primero)
   - Se registra movimiento de salida en inventario
   - Se asocia a la caja abierta (si existe)
7. **Ventas recientes:** Panel lateral con las ultimas ventas del dia

- **Validaciones:**
  - No permite vender si no hay stock suficiente
  - El precio de venta se toma del producto registrado

### 5.7 Caja
**Ruta:** Menu lateral > Caja

- **Abrir caja:** Ingresar monto de apertura > Clic en "Abrir Caja"
- **Movimientos manuales:** Registrar ingresos o egresos con descripcion
- **Cerrar caja:**
  1. Ingresar monto de cierre real (dinero contado fisicamente)
  2. El sistema calcula el monto esperado (apertura + ventas efectivo + ingresos - egresos)
  3. Muestra la diferencia (sobrante o faltante)
  4. Clic en "Cerrar Caja"
- **Resumen:** Tarjetas con monto apertura, ventas, ingresos, egresos y saldo

### 5.8 Mermas
**Ruta:** Menu lateral > Mermas

- **Registrar merma:**
  1. Seleccionar producto
  2. Ingresar cantidad
  3. Seleccionar motivo: vencimiento, dano, robo, ajuste, otro
  4. Escribir descripcion
  5. Guardar
- **Efecto:** Se descuenta del inventario y se registra movimiento tipo "merma"
- **Listado:** Filtrar por producto o motivo

### 5.9 Clientes
**Ruta:** Menu lateral > Clientes

- **Crear:** Documento (unico), nombre, telefono, email
- **Buscar:** Por nombre o documento
- **Uso:** Se asocian opcionalmente a las ventas en el POS

### 5.10 Reportes
**Ruta:** Menu lateral > Reportes

Disponible para: admin, gerente, supervisor

4 pestanas:
- **Ventas diarias:** Total de ventas del dia, cantidad de transacciones, desglose por metodo de pago
- **Productos mas vendidos:** Ranking de productos por cantidad vendida (configurable por periodo)
- **Inventario valorizado:** Stock actual multiplicado por costo unitario, total del inventario
- **Resumen de mermas:** Agrupacion por motivo, cantidades y productos afectados

### 5.11 Auditoria
**Ruta:** Menu lateral > Auditoria

Disponible para: admin, gerente

- Historial de todas las acciones realizadas en el sistema
- Campos: fecha, usuario, accion, entidad afectada, detalle, IP
- Filtros por usuario, entidad y rango de fechas

---

## 6. Roles y permisos

| Modulo | Admin | Cajero | Bodeguero | Supervisor | Gerente |
|---|---|---|---|---|---|
| Dashboard | Si | Si | Si | Si | Si |
| Categorias | CRUD | Ver | Ver | CRUD | Ver |
| Productos | CRUD | Ver | Ver | CRUD | Ver |
| Proveedores | CRUD | Ver | Ver | CRUD | Ver |
| Compras | Crear/Anular | - | Crear | Crear/Anular | Ver |
| Inventario | Todo | Ver | Ajustar | Todo | Ver |
| POS (Ventas) | Si | Si | - | Si | - |
| Caja | Si | Si | - | Si | - |
| Mermas | Registrar | - | Registrar | Registrar | Ver |
| Reportes | Si | - | - | Si | Si |
| Auditoria | Si | - | - | - | Si |
| Usuarios | Crear | - | - | - | - |

---

## 7. Reglas de negocio importantes

1. **FIFO (First In, First Out):** Las ventas siempre descuentan del lote mas antiguo primero
2. **No se puede vender sin stock:** El sistema valida antes de completar la venta
3. **Soft delete:** Categorias, productos y proveedores se desactivan, no se eliminan permanentemente
4. **Codigos unicos:** NIT de proveedor, codigo de producto, documento de cliente y username no se pueden repetir
5. **Precios positivos:** No se aceptan precios de compra o venta negativos
6. **Caja obligatoria:** Las ventas se asocian a la caja abierta del cajero
7. **Trazabilidad completa:** Cada accion queda registrada en la tabla de auditoria

---

## 8. API REST (Swagger)

Para acceder a la documentacion interactiva de la API:
- Abrir http://localhost:8000/docs (Swagger UI)
- Hacer clic en "Authorize" e ingresar el token JWT obtenido del login
- Se pueden probar todos los endpoints directamente desde el navegador

---

## 9. Ejecutar tests

```bash
cd backend
pip install -r requirements.txt
pytest tests/ -v
```

Los tests usan SQLite en memoria, no requieren PostgreSQL.

---

## 10. Cargar datos iniciales (seed)

```bash
cd backend
python -m database.seeds.seed_data
```

Esto crea: 5 usuarios, 10 categorias, 30 productos, 5 proveedores y 5 clientes de ejemplo.

---

## 11. Solucion de problemas

| Problema | Solucion |
|---|---|
| No carga la pagina | Verificar que Docker Desktop este corriendo y el contenedor activo |
| Error de conexion a BD | Revisar que PostgreSQL este corriendo en puerto 5432 |
| Login no funciona | Verificar credenciales desde la seccion demo del login |
| No aparece menu lateral | Verificar que el token JWT no haya expirado. Cerrar sesion y volver a entrar |
| Error al crear venta | Verificar que el producto tenga stock disponible |
| No puede abrir caja | Solo un cajero puede tener una caja abierta a la vez |

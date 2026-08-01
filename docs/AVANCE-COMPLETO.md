# Supermercado Avicola - Avance Completo de Construccion

**Fecha:** 2026-03-09
**Autor:** Wilson Andres Camacho Culma
**Estado:** Proyecto completo - Backend + Frontend + Tests + Migraciones + Seeds
**Errores de sintaxis:** 0

---

## Sprints completados

| Sprint | Modulo | Estado |
|---|---|---|
| 1 | Entorno + Modelo de datos + Autenticacion | Completo |
| 2 | Catalogo (Categorias, Productos, Proveedores) | Completo |
| 3 | Compras, Lotes e Inventario | Completo |
| 4 | Ventas / POS + Clientes | Completo |
| 5 | Caja, Mermas | Completo |
| 6 | Reportes y Auditoria | Completo |
| 7 | Frontend Bootstrap 5 (13 paginas HTML) | Completo |
| 8 | Alembic (migraciones versionadas) | Completo |
| 9 | Seed de datos (30 productos avicolas) | Completo |
| 10 | Tests unitarios (27 tests, SQLite en memoria) | Completo |
| 11 | Manual de usuario | Completo |
| 12 | Ejecucion local sin Docker (SQLite) + Fixes de compatibilidad | Completo |
| 13 | Documento explicativo detallado Frontend y Backend | Completo |

---

## Estructura final del proyecto

```
supermercado-avicola/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth.py              # Login, registro, perfil
│   │   │   ├── categorias.py        # CRUD categorias
│   │   │   ├── productos.py         # CRUD productos
│   │   │   ├── proveedores.py       # CRUD proveedores
│   │   │   ├── compras.py           # Registro y anulacion de compras
│   │   │   ├── inventario.py        # Stock, lotes, alertas, ajustes
│   │   │   ├── clientes.py          # CRUD clientes
│   │   │   ├── ventas.py            # POS: crear/anular ventas (FIFO)
│   │   │   ├── caja.py              # Abrir/cerrar caja, movimientos
│   │   │   ├── mermas.py            # Registro de mermas
│   │   │   ├── reportes.py          # Ventas diarias, top productos, inventario valorizado
│   │   │   └── auditoria.py         # Historial de acciones
│   │   ├── core/
│   │   │   ├── config.py            # Settings con pydantic-settings
│   │   │   ├── database.py          # SQLAlchemy engine + session
│   │   │   ├── deps.py              # get_current_user, require_roles
│   │   │   └── security.py          # JWT + bcrypt
│   │   ├── models/
│   │   │   ├── usuario.py            # 5 roles
│   │   │   ├── categoria.py
│   │   │   ├── producto.py           # Unidades de medida, perecedero
│   │   │   ├── proveedor.py
│   │   │   ├── compra.py             # Compra + DetalleCompra
│   │   │   ├── lote.py               # Lotes con vencimiento
│   │   │   ├── inventario.py         # MovimientoInventario (6 tipos)
│   │   │   ├── cliente.py
│   │   │   ├── venta.py              # Venta + DetalleVenta
│   │   │   ├── caja.py               # Caja + MovimientoCaja
│   │   │   ├── merma.py              # 5 motivos de merma
│   │   │   └── auditoria.py
│   │   ├── schemas/
│   │   │   ├── usuario.py
│   │   │   ├── categoria.py
│   │   │   ├── producto.py
│   │   │   ├── proveedor.py
│   │   │   ├── compra.py
│   │   │   ├── lote.py
│   │   │   ├── inventario.py
│   │   │   ├── cliente.py
│   │   │   ├── venta.py
│   │   │   ├── caja.py
│   │   │   ├── merma.py
│   │   │   └── auditoria.py
│   │   ├── services/
│   │   └── main.py
│   ├── tests/
│   │   ├── conftest.py          # SQLite en memoria, fixtures
│   │   ├── test_auth.py         # 9 tests de autenticacion
│   │   ├── test_categorias.py   # 7 tests CRUD categorias
│   │   ├── test_productos.py    # 6 tests CRUD productos
│   │   └── test_ventas.py       # 5 tests ventas + FIFO
│   ├── alembic/
│   │   ├── env.py
│   │   ├── script.py.mako
│   │   └── versions/001_initial_schema.py
│   ├── alembic.ini
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── login.html
│   ├── index.html              # Dashboard
│   ├── categorias.html
│   ├── productos.html
│   ├── proveedores.html
│   ├── compras.html
│   ├── inventario.html         # 4 tabs: stock, lotes, movimientos, alertas
│   ├── pos.html                # Punto de venta
│   ├── caja.html               # Apertura/cierre caja
│   ├── mermas.html
│   ├── reportes.html           # 4 tabs de reportes
│   ├── clientes.html
│   ├── auditoria.html
│   └── static/
│       ├── js/api.js           # Cliente API con JWT
│       ├── js/layout.js        # Sidebar dinamico por rol
│       └── css/style.css       # Tema verde corporativo
├── database/
│   └── seeds/seed_data.py      # 5 usuarios, 10 categorias, 30 productos, 5 proveedores, 5 clientes
├── docs/
├── infra/
│   └── docker-compose.yml
├── .env / .env.example
├── iniciar.bat / detener.bat
└── .gitignore
```

---

## Todos los endpoints de la API (40+)

### Autenticacion
| Metodo | Ruta | Descripcion | Acceso |
|---|---|---|---|
| POST | `/api/auth/login` | Login con JWT | Publico |
| POST | `/api/auth/register` | Crear usuario | Admin |
| GET | `/api/auth/me` | Perfil actual | Autenticado |

### Categorias
| Metodo | Ruta | Descripcion | Acceso |
|---|---|---|---|
| GET | `/api/categorias/` | Listar (filtro por activa) | Autenticado |
| GET | `/api/categorias/{id}` | Obtener una | Autenticado |
| POST | `/api/categorias/` | Crear | Autenticado |
| PUT | `/api/categorias/{id}` | Actualizar | Autenticado |
| DELETE | `/api/categorias/{id}` | Desactivar (soft delete) | Autenticado |

### Productos
| Metodo | Ruta | Descripcion | Acceso |
|---|---|---|---|
| GET | `/api/productos/` | Listar (filtros: activo, categoria, buscar, perecedero) | Autenticado |
| GET | `/api/productos/{id}` | Obtener con nombre de categoria | Autenticado |
| POST | `/api/productos/` | Crear (valida codigo unico, categoria existe) | Autenticado |
| PUT | `/api/productos/{id}` | Actualizar | Autenticado |
| DELETE | `/api/productos/{id}` | Desactivar | Autenticado |

### Proveedores
| Metodo | Ruta | Descripcion | Acceso |
|---|---|---|---|
| GET | `/api/proveedores/` | Listar (filtro: activo, buscar) | Autenticado |
| GET | `/api/proveedores/{id}` | Obtener uno | Autenticado |
| POST | `/api/proveedores/` | Crear (NIT unico) | Autenticado |
| PUT | `/api/proveedores/{id}` | Actualizar | Autenticado |
| DELETE | `/api/proveedores/{id}` | Desactivar | Autenticado |

### Compras
| Metodo | Ruta | Descripcion | Acceso |
|---|---|---|---|
| GET | `/api/compras/` | Listar (filtros: estado, proveedor) | Autenticado |
| GET | `/api/compras/{id}` | Obtener con detalles | Autenticado |
| POST | `/api/compras/` | Crear compra + genera lotes + entrada inventario | Admin/Bodeguero/Supervisor |
| POST | `/api/compras/{id}/anular` | Anular + reversa inventario | Admin/Supervisor |

### Inventario
| Metodo | Ruta | Descripcion | Acceso |
|---|---|---|---|
| GET | `/api/inventario/stock` | Stock actual por producto (alerta bajo stock) | Autenticado |
| GET | `/api/inventario/lotes` | Listar lotes (filtro: producto, disponibles) | Autenticado |
| GET | `/api/inventario/alertas-vencimiento` | Lotes proximos a vencer | Autenticado |
| GET | `/api/inventario/movimientos` | Historial de movimientos | Autenticado |
| POST | `/api/inventario/ajuste` | Ajuste manual (+/-) | Admin/Supervisor/Bodeguero |

### Clientes
| Metodo | Ruta | Descripcion | Acceso |
|---|---|---|---|
| GET | `/api/clientes/` | Listar (buscar) | Autenticado |
| POST | `/api/clientes/` | Crear (documento unico) | Autenticado |
| PUT | `/api/clientes/{id}` | Actualizar | Autenticado |

### Ventas / POS
| Metodo | Ruta | Descripcion | Acceso |
|---|---|---|---|
| GET | `/api/ventas/` | Listar ventas | Autenticado |
| GET | `/api/ventas/{id}` | Obtener con detalles | Autenticado |
| POST | `/api/ventas/` | Crear venta (FIFO, valida stock, descuenta lotes) | Admin/Cajero/Supervisor |
| POST | `/api/ventas/{id}/anular` | Anular + devolver stock | Admin/Supervisor |

### Caja
| Metodo | Ruta | Descripcion | Acceso |
|---|---|---|---|
| GET | `/api/caja/actual` | Caja abierta del usuario | Autenticado |
| POST | `/api/caja/abrir` | Abrir caja con monto inicial | Admin/Cajero/Supervisor |
| POST | `/api/caja/cerrar` | Cerrar + calcular diferencia | Admin/Cajero/Supervisor |
| POST | `/api/caja/movimiento` | Ingreso/egreso manual | Admin/Cajero/Supervisor |

### Mermas
| Metodo | Ruta | Descripcion | Acceso |
|---|---|---|---|
| GET | `/api/mermas/` | Listar (filtros: producto, motivo) | Autenticado |
| POST | `/api/mermas/` | Registrar merma + movimiento inventario | Admin/Supervisor/Bodeguero |

### Reportes
| Metodo | Ruta | Descripcion | Acceso |
|---|---|---|---|
| GET | `/api/reportes/ventas-diarias` | Ventas del dia con totales | Admin/Gerente/Supervisor |
| GET | `/api/reportes/productos-mas-vendidos` | Top productos por cantidad | Admin/Gerente/Supervisor |
| GET | `/api/reportes/inventario-valorizado` | Stock valorizado a costo | Admin/Gerente/Supervisor |
| GET | `/api/reportes/mermas-resumen` | Resumen de mermas por motivo | Admin/Gerente/Supervisor |

### Auditoria
| Metodo | Ruta | Descripcion | Acceso |
|---|---|---|---|
| GET | `/api/auditoria/` | Historial de acciones | Admin/Gerente |

---

## Reglas de negocio implementadas

1. **No vender sin stock:** Valida stock disponible antes de crear venta
2. **FIFO obligatorio:** Las ventas descuentan lotes del mas antiguo al mas reciente
3. **Lotes con vencimiento:** Cada compra genera lotes con fecha de ingreso
4. **Alertas de vencimiento:** Endpoint configurable por dias
5. **Mermas con trazabilidad:** Registran motivo, responsable, fecha y afectan inventario
6. **Roles y permisos:** Cada endpoint valida el rol del usuario
7. **Ventas auditables:** Anulacion registra movimiento de devolucion
8. **Caja con arqueo:** Calcula monto esperado vs cierre real + diferencia
9. **Soft delete:** Categorias, productos y proveedores se desactivan, no se eliminan
10. **Precios validados:** No se aceptan precios negativos
11. **Codigos unicos:** Validacion de NIT, codigo producto, documento cliente, username

---

## Modelo de datos: 15 tablas

| Tabla | Campos clave |
|---|---|
| `usuarios` | username, email, rol (5 roles), hashed_password, activo |
| `categorias` | nombre (unico), activa |
| `productos` | codigo (unico), categoria_id, precios, unidad_medida, es_perecedero |
| `proveedores` | nit (unico), nombre, contacto, telefono |
| `compras` | proveedor_id, usuario_id, total, estado (pendiente/recibida/anulada) |
| `detalle_compras` | compra_id, producto_id, cantidad, costo_unitario |
| `lotes` | codigo_lote, producto_id, cantidad_disponible, fecha_vencimiento |
| `movimientos_inventario` | tipo (6 tipos), cantidad, referencia |
| `clientes` | documento (unico), nombre |
| `ventas` | numero (auto), metodo_pago, estado, caja_id |
| `detalle_ventas` | venta_id, producto_id, lote_id, precio_unitario |
| `cajas` | monto_apertura, monto_cierre, monto_esperado, diferencia |
| `movimientos_caja` | tipo (4 tipos), monto |
| `mermas` | motivo (5 tipos), cantidad, descripcion |
| `auditoria` | accion, entidad, detalle, ip |

---

## Pasos para ejecutar

### Opcion 1 - Sin Docker (ejecucion local con SQLite):
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
Abrir http://localhost:8000 y usar la seccion de acceso demo. Las contrasenas no se documentan en texto plano.

El sistema detecta automaticamente si hay PostgreSQL o usa SQLite segun la variable `DATABASE_URL` en `.env`. Por defecto usa SQLite local (`sqlite:///./supermercado_avicola.db`).

### Opcion 2 - Con Docker (PostgreSQL):
1. Iniciar Docker Desktop
2. Cambiar `DATABASE_URL` en `.env` a: `postgresql://avicola_user:avicola_pass@db:5432/supermercado_avicola`
3. Doble clic en `iniciar.bat`
4. Abrir http://localhost:8000

### Swagger UI (documentacion interactiva):
http://localhost:8000/docs

---

## Componentes adicionales completados

### Alembic - Migraciones versionadas
- Configuracion en `backend/alembic.ini`
- Migracion `001_initial_schema.py` con las 15 tablas
- Ejecutar: `cd backend && alembic upgrade head`

### Seed de datos iniciales
- Script: `database/seeds/seed_data.py`
- Contenido: 5 usuarios (1 por rol), 10 categorias avicolas, 30 productos, 5 proveedores, 5 clientes
- Ejecutar: `cd backend && python -m database.seeds.seed_data`

### Tests (27 tests - SQLite en memoria)
- No requieren PostgreSQL
- Ejecutar: `cd backend && pytest tests/ -v`
- Cobertura: auth, categorias, productos, ventas (FIFO)

### Frontend Bootstrap 5 (13 paginas)
- Sidebar dinamico filtrado por rol de usuario
- Tema verde corporativo
- Conexion al backend via `api.js` con JWT automatico
- POS con carrito, busqueda y ventas recientes
- Reportes con 4 tabs de analisis

### Manual de usuario
- Archivo: `docs/MANUAL-USUARIO.md`
- Guia completa de uso del sistema por modulo

### Documento explicativo detallado
- Archivo: `docs/EXPLICACION-DETALLADA-FRONTEND-Y-BACKEND.md`
- 11 secciones con explicacion archivo por archivo
- Preguntas frecuentes para exposicion de grado

---

## Fixes de compatibilidad aplicados (Sprint 12)

| Archivo | Cambio | Motivo |
|---|---|---|
| `.env` | `DATABASE_URL=sqlite:///./supermercado_avicola.db` | Permite ejecutar sin Docker ni PostgreSQL |
| `core/config.py` | `env_file = [".env", "../.env"]` | Busca .env tanto en backend/ como en la raiz del proyecto |
| `core/database.py` | Soporte dual SQLite/PostgreSQL | Detecta el motor y ajusta `check_same_thread` y `PRAGMA foreign_keys` para SQLite |
| `core/security.py` | Reemplazo de `passlib` por `bcrypt` directo | passlib es incompatible con bcrypt 5.x en Python 3.13 |
| `api/auth.py` | `"sub": str(user.id)` en el token JWT | python-jose exige que el claim `sub` sea string, no int |
| `core/deps.py` | `int(user_id_raw)` al leer el sub del token | Convierte el sub string de vuelta a int para la consulta SQL |

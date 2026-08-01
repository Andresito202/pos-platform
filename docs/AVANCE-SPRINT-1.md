# Avance Sprint 1 - Entorno + Modelo de Datos + Autenticacion

**Fecha:** 2026-03-09
**Autor:** Wilson Andres Camacho Culma
**Estado:** Completo (pendiente: instalacion de dependencias e inicio de Docker)

---

## Resumen de lo construido

### 1. Estructura del repositorio
```
supermercado-avicola/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   └── auth.py              # Endpoints de autenticacion
│   │   ├── core/
│   │   │   ├── __init__.py
│   │   │   ├── config.py            # Configuracion con pydantic-settings
│   │   │   ├── database.py          # Engine SQLAlchemy + SessionLocal
│   │   │   ├── deps.py              # Dependencias (get_current_user, require_roles)
│   │   │   └── security.py          # JWT + bcrypt
│   │   ├── models/
│   │   │   ├── __init__.py           # Importa todos los modelos
│   │   │   ├── usuario.py            # Usuarios y roles
│   │   │   ├── categoria.py          # Categorias de productos
│   │   │   ├── producto.py           # Catalogo de productos
│   │   │   ├── proveedor.py          # Proveedores
│   │   │   ├── compra.py             # Compras + DetalleCompra
│   │   │   ├── lote.py               # Lotes con vencimiento
│   │   │   ├── inventario.py         # Movimientos de inventario
│   │   │   ├── cliente.py            # Clientes
│   │   │   ├── venta.py              # Ventas + DetalleVenta
│   │   │   ├── caja.py               # Caja + MovimientoCaja
│   │   │   ├── merma.py              # Mermas
│   │   │   └── auditoria.py          # Auditoria de acciones
│   │   ├── schemas/
│   │   │   ├── __init__.py
│   │   │   └── usuario.py            # Schemas Pydantic de auth
│   │   ├── services/
│   │   │   └── __init__.py
│   │   ├── __init__.py
│   │   └── main.py                   # App FastAPI + lifespan
│   ├── tests/
│   │   └── __init__.py
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── static/ (css, js, img)
│   └── templates/
├── database/
│   ├── migrations/
│   └── seeds/
├── docs/
│   └── AVANCE-SPRINT-1.md
├── infra/
│   └── docker-compose.yml
├── .env
├── .env.example
├── .gitignore
├── iniciar.bat
└── detener.bat
```

---

## 2. Stack implementado

| Componente | Tecnologia |
|---|---|
| Backend | Python 3.12, FastAPI |
| ORM | SQLAlchemy 2.0 (mapped_column) |
| Base de datos | PostgreSQL 16 (via Docker) |
| Autenticacion | JWT (python-jose) + bcrypt |
| Validacion | Pydantic v2 |
| Configuracion | pydantic-settings + .env |
| Infraestructura | Docker Compose |

---

## 3. Entidades del modelo de datos (15 tablas)

| Tabla | Descripcion |
|---|---|
| `usuarios` | Usuarios del sistema con roles (admin, cajero, bodeguero, supervisor, gerente) |
| `categorias` | Clasificacion de productos |
| `productos` | Catalogo con precios, unidad de medida, perecedero si/no |
| `proveedores` | Datos de proveedores (NIT, contacto) |
| `compras` | Cabecera de compra a proveedor |
| `detalle_compras` | Renglones de cada compra |
| `lotes` | Control por lote: fecha ingreso, vencimiento, cantidad disponible |
| `movimientos_inventario` | Historial de entradas, salidas, ajustes, mermas |
| `clientes` | Datos basicos de clientes |
| `ventas` | Cabecera de venta (numero, metodo pago, estado) |
| `detalle_ventas` | Productos vendidos con lote afectado |
| `cajas` | Apertura/cierre de caja con montos |
| `movimientos_caja` | Ingresos, egresos y ventas por turno |
| `mermas` | Perdidas por vencimiento, dano, robo, ajuste |
| `auditoria` | Historial de acciones criticas |

---

## 4. Endpoints de autenticacion

| Metodo | Ruta | Descripcion | Acceso |
|---|---|---|---|
| POST | `/api/auth/login` | Inicio de sesion, retorna JWT + datos usuario | Publico |
| POST | `/api/auth/register` | Crear usuario nuevo | Solo admin |
| GET | `/api/auth/me` | Datos del usuario autenticado | Autenticado |
| GET | `/api/health` | Health check del sistema | Publico |

---

## 5. Reglas de negocio implementadas en este sprint

- 5 roles definidos: admin, cajero, bodeguero, supervisor, gerente
- Solo admin puede crear usuarios nuevos
- Passwords hasheados con bcrypt (nunca en texto plano)
- JWT con expiracion configurable (default 8 horas)
- Usuarios inactivos no pueden autenticarse
- Validacion de username y email unicos
- Admin inicial creado automaticamente al iniciar el sistema

---

## 6. Pasos para ejecutar

### Opcion 1: Docker (recomendada)
```bash
# Iniciar Docker Desktop primero
# Luego doble clic en iniciar.bat o:
cd infra
docker compose up --build -d
```
- API: http://localhost:8000
- Docs Swagger: http://localhost:8000/docs
- Admin inicial: admin / ********

### Opcion 2: Sin Docker (desarrollo local)
```bash
cd backend
pip install -r requirements.txt
# Ajustar DATABASE_URL en .env para apuntar a PostgreSQL local
uvicorn app.main:app --reload --port 8000
```

---

## 7. Pruebas manuales sugeridas

### Login:
```
POST http://localhost:8000/api/auth/login
Body: {"username": "admin", "password": "********"}
```

### Crear usuario (con token de admin):
```
POST http://localhost:8000/api/auth/register
Headers: Authorization: Bearer <token>
Body: {"username": "cajero1", "email": "cajero1@avicola.local", "password": "********", "nombre_completo": "Juan Perez", "rol": "cajero"}
```

### Ver perfil:
```
GET http://localhost:8000/api/auth/me
Headers: Authorization: Bearer <token>
```

---

## Siguiente sprint: Catalogo y proveedores (CRUD productos, categorias, proveedores)

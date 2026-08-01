# EXPLICACION DETALLADA DEL PROYECTO - FRONTEND Y BACKEND
# Sistema de Gestion - Supermercado Avicola

**Proyecto:** Software de Gestion Integral para Supermercado Avicola
**Autor:** Wilson Andres Camacho Culma
**Universidad:** UNIMINUTO
**Fecha:** Marzo 2026

---

## TABLA DE CONTENIDO

1. [Que es este proyecto y para que sirve](#1-que-es-este-proyecto)
2. [Tecnologias utilizadas y por que se eligieron](#2-tecnologias)
3. [Estructura completa del proyecto (donde queda cada cosa)](#3-estructura)
4. [BACKEND - Explicacion archivo por archivo](#4-backend)
5. [FRONTEND - Explicacion pagina por pagina](#5-frontend)
6. [Como se conectan Frontend y Backend](#6-conexion)
7. [Base de datos - Las 15 tablas explicadas](#7-base-de-datos)
8. [Logica de negocio clave (FIFO, Caja, Roles)](#8-logica-negocio)
9. [Docker y despliegue](#9-docker)
10. [Tests y calidad](#10-tests)
11. [Preguntas frecuentes de exposicion](#11-preguntas)

---

## 1. QUE ES ESTE PROYECTO

Es un **sistema web completo** para administrar un supermercado especializado en productos avicolas (pollo, presas, huevos, embutidos). Permite:

- **Gestionar el catalogo** de productos, categorias y proveedores
- **Registrar compras** a proveedores (genera lotes con fecha de vencimiento)
- **Vender en punto de venta (POS)** con descuento automatico de inventario por FIFO
- **Controlar inventario** con lotes, alertas de vencimiento y stock bajo
- **Manejar caja** con apertura, cierre y arqueo (diferencia entre lo esperado y lo real)
- **Registrar mermas** (producto danado, vencido, robado)
- **Generar reportes** de ventas, productos mas vendidos, inventario valorizado
- **Auditar** todas las acciones del sistema (quien hizo que y cuando)
- **Controlar acceso** con 5 roles diferentes (admin, cajero, bodeguero, supervisor, gerente)

### Arquitectura general

```
┌─────────────────────────────────────────────────────┐
│                    USUARIO                          │
│              (Navegador web)                        │
└──────────────────┬──────────────────────────────────┘
                   │ HTTP (puerto 8000)
┌──────────────────▼──────────────────────────────────┐
│              FRONTEND                               │
│  13 paginas HTML + Bootstrap 5 + JavaScript         │
│  Archivos servidos por FastAPI (StaticFiles)        │
└──────────────────┬──────────────────────────────────┘
                   │ fetch() con JWT Token
┌──────────────────▼──────────────────────────────────┐
│              BACKEND (FastAPI)                       │
│  12 routers / 43+ endpoints / Python 3.12           │
│  Autenticacion JWT + Control de roles               │
└──────────────────┬──────────────────────────────────┘
                   │ SQLAlchemy ORM
┌──────────────────▼──────────────────────────────────┐
│           BASE DE DATOS (PostgreSQL 16)             │
│  15 tablas / Relaciones FK / Enums                  │
└─────────────────────────────────────────────────────┘
```

**Flujo simplificado:** El usuario abre el navegador → ve las paginas HTML (frontend) → al hacer clic en botones, JavaScript llama a la API (backend) → el backend consulta/modifica la base de datos → devuelve la respuesta → el frontend la muestra en pantalla.

---

## 2. TECNOLOGIAS UTILIZADAS

### Backend
| Tecnologia | Version | Para que sirve |
|---|---|---|
| **Python** | 3.12 | Lenguaje de programacion del servidor |
| **FastAPI** | 0.115.6 | Framework web para crear la API REST. Es rapido, moderno y genera documentacion automatica (Swagger) |
| **SQLAlchemy** | 2.0.36 | ORM (Object Relational Mapper) - permite interactuar con la base de datos usando clases de Python en vez de SQL puro |
| **Pydantic** | 2.10.4 | Validacion de datos. Asegura que los datos que llegan a la API tengan el formato correcto |
| **python-jose** | 3.3.0 | Crear y verificar tokens JWT para autenticacion |
| **bcrypt** | 4.2.1 | Encriptar contrasenas de forma segura (nunca se guarda la contrasena en texto plano) |
| **Alembic** | 1.14.1 | Migraciones de base de datos (versionado de cambios en las tablas) |
| **Uvicorn** | 0.34.0 | Servidor ASGI que ejecuta la aplicacion FastAPI |
| **psycopg2** | 2.9.10 | Driver para conectar Python con PostgreSQL |

### Frontend
| Tecnologia | Para que sirve |
|---|---|
| **HTML5** | Estructura de las paginas |
| **Bootstrap 5.3** | Framework CSS para disenar interfaces responsivas sin escribir mucho CSS |
| **JavaScript (Vanilla)** | Logica del lado del cliente, llamadas a la API, manipulacion del DOM |
| **CSS personalizado** | Tema verde corporativo, sidebar, cards |

### Infraestructura
| Tecnologia | Para que sirve |
|---|---|
| **Docker** | Contenerizar la aplicacion (empaquetarla para que funcione igual en cualquier computador) |
| **Docker Compose** | Orquestar multiples contenedores (backend + base de datos) |
| **PostgreSQL 16** | Base de datos relacional robusta y de grado empresarial |

### Testing
| Tecnologia | Para que sirve |
|---|---|
| **pytest** | Framework de pruebas unitarias |
| **httpx** | Cliente HTTP para hacer peticiones en los tests |
| **SQLite en memoria** | Base de datos temporal para tests (no necesita PostgreSQL) |

### Por que estas tecnologias?
- **FastAPI** es el framework de Python mas rapido y moderno, con documentacion automatica
- **PostgreSQL** es la base de datos relacional mas robusta y usada en produccion
- **Bootstrap 5** permite crear interfaces profesionales rapidamente sin depender de frameworks JS pesados
- **Docker** garantiza que el proyecto funcione igual en cualquier maquina
- **JWT** es el estandar de la industria para autenticacion en APIs REST

---

## 3. ESTRUCTURA COMPLETA DEL PROYECTO

```
supermercado-avicola/
│
├── backend/                          # TODO EL SERVIDOR (Python/FastAPI)
│   ├── app/                          # Codigo fuente principal
│   │   ├── __init__.py               # Marca el directorio como paquete Python
│   │   ├── main.py                   # PUNTO DE ENTRADA - arranca la aplicacion
│   │   │
│   │   ├── core/                     # NUCLEO - configuracion y seguridad
│   │   │   ├── __init__.py
│   │   │   ├── config.py             # Lee variables de entorno (.env)
│   │   │   ├── database.py           # Conexion a PostgreSQL con SQLAlchemy
│   │   │   ├── security.py           # JWT tokens + encriptacion de contrasenas
│   │   │   └── deps.py               # Dependencias: quien esta logueado, que rol tiene
│   │   │
│   │   ├── models/                   # MODELOS - representan las tablas de la BD
│   │   │   ├── __init__.py           # Importa todos los modelos
│   │   │   ├── usuario.py            # Tabla usuarios (5 roles)
│   │   │   ├── categoria.py          # Tabla categorias
│   │   │   ├── producto.py           # Tabla productos (con unidad de medida)
│   │   │   ├── proveedor.py          # Tabla proveedores (con NIT)
│   │   │   ├── compra.py             # Tablas compras + detalle_compras
│   │   │   ├── lote.py               # Tabla lotes (con vencimiento)
│   │   │   ├── inventario.py         # Tabla movimientos_inventario
│   │   │   ├── cliente.py            # Tabla clientes
│   │   │   ├── venta.py              # Tablas ventas + detalle_ventas
│   │   │   ├── caja.py               # Tablas cajas + movimientos_caja
│   │   │   ├── merma.py              # Tabla mermas
│   │   │   └── auditoria.py          # Tabla auditoria
│   │   │
│   │   ├── schemas/                  # ESQUEMAS - validacion de datos de entrada/salida
│   │   │   ├── usuario.py            # LoginRequest, UsuarioCreate, UsuarioOut...
│   │   │   ├── categoria.py          # CategoriaCreate, CategoriaOut...
│   │   │   ├── producto.py           # ProductoCreate, ProductoOut (con validadores)
│   │   │   ├── proveedor.py          # ProveedorCreate, ProveedorOut...
│   │   │   ├── compra.py             # CompraCreate con detalles, CompraOut...
│   │   │   ├── lote.py               # LoteOut, AlertaVencimiento...
│   │   │   ├── inventario.py         # StockProducto, AjusteInventarioIn...
│   │   │   ├── cliente.py            # ClienteCreate, ClienteOut...
│   │   │   ├── venta.py              # VentaCreate con detalles, VentaOut...
│   │   │   ├── caja.py               # CajaAbrirIn, CajaCerrarIn, CajaOut...
│   │   │   ├── merma.py              # MermaCreate, MermaOut...
│   │   │   └── auditoria.py          # AuditoriaOut
│   │   │
│   │   ├── api/                      # RUTAS - los endpoints de la API
│   │   │   ├── auth.py               # /api/auth/login, register, me
│   │   │   ├── categorias.py         # /api/categorias/ CRUD
│   │   │   ├── productos.py          # /api/productos/ CRUD + filtros
│   │   │   ├── proveedores.py        # /api/proveedores/ CRUD
│   │   │   ├── compras.py            # /api/compras/ crear, anular
│   │   │   ├── inventario.py         # /api/inventario/ stock, lotes, alertas, ajuste
│   │   │   ├── clientes.py           # /api/clientes/ CRUD
│   │   │   ├── ventas.py             # /api/ventas/ crear (FIFO), anular
│   │   │   ├── caja.py               # /api/caja/ abrir, cerrar, movimiento
│   │   │   ├── mermas.py             # /api/mermas/ listar, crear
│   │   │   ├── reportes.py           # /api/reportes/ 4 tipos de reporte
│   │   │   └── auditoria.py          # /api/auditoria/ historial
│   │   │
│   │   └── services/                 # (Reservado para logica de negocio compleja)
│   │
│   ├── tests/                        # PRUEBAS AUTOMATIZADAS
│   │   ├── conftest.py               # Configuracion: BD SQLite en memoria, fixtures
│   │   ├── test_auth.py              # 9 tests de autenticacion
│   │   ├── test_categorias.py        # 7 tests de categorias
│   │   ├── test_productos.py         # 6 tests de productos
│   │   └── test_ventas.py            # 5 tests de ventas y FIFO
│   │
│   ├── alembic/                      # MIGRACIONES DE BASE DE DATOS
│   │   ├── env.py                    # Configuracion de Alembic
│   │   ├── script.py.mako            # Template para nuevas migraciones
│   │   └── versions/
│   │       └── 001_initial_schema.py # Migracion: crea las 15 tablas
│   │
│   ├── alembic.ini                   # Configuracion general de Alembic
│   ├── Dockerfile                    # Instrucciones para construir la imagen Docker
│   └── requirements.txt              # Lista de dependencias Python
│
├── frontend/                         # TODO EL CLIENTE (HTML/CSS/JS)
│   ├── login.html                    # Pagina de inicio de sesion
│   ├── index.html                    # Dashboard principal
│   ├── categorias.html               # Gestion de categorias
│   ├── productos.html                # Gestion de productos
│   ├── proveedores.html              # Gestion de proveedores
│   ├── compras.html                  # Registro de compras
│   ├── inventario.html               # Control de inventario (4 tabs)
│   ├── pos.html                      # Punto de venta
│   ├── caja.html                     # Gestion de caja
│   ├── mermas.html                   # Registro de mermas
│   ├── reportes.html                 # Reportes y estadisticas
│   ├── clientes.html                 # Gestion de clientes
│   ├── auditoria.html                # Log de auditoria
│   └── static/
│       ├── js/
│       │   ├── api.js                # Cliente API: manejo de token, llamadas HTTP
│       │   └── layout.js             # Sidebar dinamico, topbar, filtro por rol
│       └── css/
│           └── style.css             # Estilos: tema verde, sidebar, responsive
│
├── database/
│   └── seeds/
│       └── seed_data.py              # Datos iniciales: 5 usuarios, 30 productos...
│
├── docs/                             # DOCUMENTACION
│   ├── AVANCE-COMPLETO.md            # Resumen de todos los sprints
│   ├── AVANCE-SPRINT-1.md            # Detalle del sprint 1
│   ├── MANUAL-USUARIO.md             # Guia de uso del sistema
│   └── EXPLICACION-DETALLADA-...md   # ESTE DOCUMENTO
│
├── infra/
│   └── docker-compose.yml            # Orquestacion: PostgreSQL + Backend
│
├── .env                              # Variables de entorno (credenciales, BD)
├── .env.example                      # Plantilla del .env
├── .gitignore                        # Archivos que Git debe ignorar
├── iniciar.bat                       # Script Windows para arrancar Docker
└── detener.bat                       # Script Windows para detener Docker
```

---

## 4. BACKEND - EXPLICACION ARCHIVO POR ARCHIVO

### 4.1 main.py - El punto de entrada

**Ubicacion:** `backend/app/main.py`
**Que hace:** Es el archivo principal que arranca toda la aplicacion.

**Paso a paso de lo que ocurre al iniciar:**
1. Crea la instancia de FastAPI con CORS habilitado (permite que el frontend se comunique)
2. En el **lifespan** (evento de inicio):
   - Crea todas las tablas en la base de datos si no existen
   - Crea el usuario administrador por defecto si no existe
3. Registra los **12 routers** (cada modulo de la API)
4. Monta los archivos estaticos del frontend (HTML, CSS, JS)
5. Define rutas para servir las paginas HTML

**Concepto clave - CORS:**
CORS (Cross-Origin Resource Sharing) permite que el frontend en un origen (ej: localhost:3000) pueda llamar al backend en otro origen (localhost:8000). Sin esto, el navegador bloquea las peticiones.

**Concepto clave - Lifespan:**
Es un evento que se ejecuta UNA sola vez cuando el servidor arranca. Aqui aprovechamos para crear tablas y el admin.

---

### 4.2 core/config.py - Configuracion

**Ubicacion:** `backend/app/core/config.py`
**Que hace:** Lee las variables del archivo `.env` y las expone como un objeto Python.

**Como funciona:**
```python
class Settings(BaseSettings):
    DB_USER: str = "avicola_user"       # Se lee de .env o usa el valor por defecto
    DB_PASSWORD: str = "avicola_pass"
    SECRET_KEY: str                     # Obligatoria: se lee de variables de entorno
    ADMIN_PASSWORD: str                 # Obligatoria: se lee de variables de entorno
    DATABASE_URL: str = ""              # Si se define, tiene prioridad sobre las variables individuales
    ...

    @property
    def db_url(self) -> str:
        if self.DATABASE_URL:            # Prioridad: usar DATABASE_URL directo
            return self.DATABASE_URL
        # Si no, construye la URL de PostgreSQL con las variables individuales
        return f"postgresql://{self.DB_USER}:{self.DB_PASSWORD}@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"

    class Config:
        env_file = [".env", "../.env"]   # Busca .env en backend/ y tambien en la raiz del proyecto
        extra = "ignore"
```

**Detalle importante:** El `env_file` acepta una lista. Esto permite que funcione tanto ejecutando desde `backend/` como desde la raiz del proyecto. El archivo `.env` se busca en ambas ubicaciones.

**Por que se usa .env?** Para no poner credenciales directamente en el codigo. El archivo .env no se sube a Git (esta en .gitignore).

---

### 4.3 core/database.py - Conexion a la base de datos

**Ubicacion:** `backend/app/core/database.py`
**Que hace:** Configura la conexion a la base de datos usando SQLAlchemy. Soporta PostgreSQL y SQLite.

**Componentes:**
- **engine**: El "motor" que se conecta a la base de datos
- **SessionLocal**: Fabrica de sesiones (cada peticion HTTP usa una sesion independiente)
- **Base**: Clase padre de todos los modelos (tablas)
- **get_db()**: Funcion generadora que entrega una sesion y la cierra al terminar

**Soporte dual SQLite/PostgreSQL:**
```python
_url = settings.db_url
if _url.startswith("sqlite"):
    # SQLite necesita check_same_thread=False para funcionar con FastAPI
    _connect_args = {"check_same_thread": False}
    # Ademas se activa PRAGMA foreign_keys para respetar las FK
else:
    # PostgreSQL usa pool_pre_ping para detectar conexiones muertas
    _kwargs = {"pool_pre_ping": True}
```
Esto permite ejecutar el proyecto localmente sin Docker (usando SQLite) o en produccion con PostgreSQL sin cambiar codigo.

**Concepto clave - Sesion:**
Una sesion es una "conversacion" con la base de datos. Cada peticion HTTP abre su propia sesion, hace sus consultas, y la cierra al terminar. Esto evita conflictos entre usuarios simultaneos.

---

### 4.4 core/security.py - JWT y contrasenas

**Ubicacion:** `backend/app/core/security.py`
**Que hace:** Dos cosas criticas de seguridad:

**1. Encriptacion de contrasenas (bcrypt directo):**
```python
import bcrypt

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
```
```
hash_password(password)  →  "$2b$12$LJ3m5..."  (irreversible)
verify_password(password, "$2b$12$LJ3m5...")  →  True
```
La contrasena NUNCA se guarda en texto plano. Se guarda el hash. Para verificar, se hashea la contrasena ingresada y se compara con el hash guardado.

**Nota tecnica:** Se usa `bcrypt` directamente en lugar de `passlib`, porque `passlib` es incompatible con `bcrypt >= 4.1` en Python 3.12+. Usar bcrypt directo es mas simple y sin dependencias intermedias.

**2. Tokens JWT (JSON Web Token):**
```
create_access_token({"sub": "1", "rol": "admin"})
→ "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIiwicm9sIjoiYWRtaW4iLCJleHAiOjE3..."
```
El token es una cadena codificada que contiene: ID del usuario, rol, y fecha de expiracion. Se firma con la SECRET_KEY para que nadie pueda falsificarlo.

**Detalle importante:** El claim `sub` (subject) del JWT **debe ser string** segun la especificacion. Por eso se convierte `user.id` a string con `str(user.id)` al crear el token, y se reconvierte a int con `int(sub)` al leer el token para consultar la base de datos.

**Flujo de autenticacion:**
```
1. Usuario envia username + password
2. Backend verifica la contrasena con bcrypt
3. Si es correcta, genera un token JWT con sub=str(user.id)
4. Frontend guarda el token en localStorage
5. En cada peticion siguiente, envia el token en el header: "Authorization: Bearer eyJ..."
6. Backend decodifica el token, extrae el sub, lo convierte a int, y busca al usuario
```

---

### 4.5 core/deps.py - Control de acceso

**Ubicacion:** `backend/app/core/deps.py`
**Que hace:** Define dos funciones que se usan como "guardianes" en cada endpoint.

**get_current_user():**
- Recibe el token del header Authorization
- Lo decodifica para obtener el ID del usuario
- Busca al usuario en la base de datos
- Si el token es invalido, expirado, o el usuario esta inactivo → Error 401

**require_roles(*roles):**
- Recibe una lista de roles permitidos (ej: "admin", "cajero")
- Verifica que el usuario actual tenga uno de esos roles
- Si no tiene permiso → Error 403 (Prohibido)

**Ejemplo de uso en un endpoint:**
```python
@router.post("/compras/")
def crear_compra(
    data: CompraCreate,
    db: Session = Depends(get_db),
    user: Usuario = Depends(require_roles(RolEnum.admin, RolEnum.bodeguero, RolEnum.supervisor))
):
    # Solo admin, bodeguero y supervisor pueden crear compras
```

---

### 4.6 models/ - Los modelos (tablas de la BD)

**Ubicacion:** `backend/app/models/`
**Que hacen:** Cada archivo define una o mas tablas de la base de datos como clases de Python.

**Concepto clave - ORM (Object Relational Mapper):**
En vez de escribir SQL puro (`INSERT INTO productos VALUES (...)`), usamos clases:
```python
class Producto(Base):
    __tablename__ = "productos"
    id = mapped_column(Integer, primary_key=True)
    nombre = mapped_column(String(150), nullable=False)
    precio_venta = mapped_column(Numeric(12, 2))
```

Luego en el codigo:
```python
# Crear producto (equivale a INSERT INTO productos ...)
prod = Producto(nombre="Pechuga", precio_venta=16000)
db.add(prod)
db.commit()

# Buscar (equivale a SELECT * FROM productos WHERE id = 1)
prod = db.query(Producto).filter(Producto.id == 1).first()
```

**Modelo usuario.py - Detalle:**
```python
class RolEnum(str, Enum):
    admin = "admin"           # Acceso total
    cajero = "cajero"         # Solo POS y caja
    bodeguero = "bodeguero"   # Solo inventario y compras
    supervisor = "supervisor" # Casi todo excepto auditoria
    gerente = "gerente"       # Solo reportes y consultas

class Usuario(Base):
    __tablename__ = "usuarios"
    id             # Identificador unico auto-incremental
    username       # Nombre de usuario (unico)
    email          # Email (unico)
    hashed_password # Contrasena encriptada con bcrypt
    nombre_completo # Nombre real
    rol            # Uno de los 5 roles
    activo         # Si esta desactivado no puede entrar
    created_at     # Cuando se creo
    updated_at     # Ultima modificacion
```

**Modelo producto.py - Detalle:**
- Tiene FK (Foreign Key) a categorias → cada producto pertenece a una categoria
- `unidad_medida`: enum con 5 opciones (unidad, kilogramo, libra, gramo, litro)
- `es_perecedero`: flag para productos que se vencen
- `stock_minimo`: umbral para alertas de bajo stock
- `activo`: soft delete (no se borra, se desactiva)

**Modelo compra.py - Detalle (2 tablas):**
- `Compra`: cabecera con proveedor, usuario, total, estado
- `DetalleCompra`: lineas con producto, cantidad, costo unitario, subtotal
- Una compra tiene MUCHOS detalles (relacion 1:N)

**Modelo lote.py - Fundamental para FIFO:**
- Cada compra genera lotes
- Cada lote tiene: cantidad_inicial, cantidad_disponible, fecha_vencimiento
- Cuando se vende, se descuenta de `cantidad_disponible`
- Cuando llega a 0, se marca como `agotado = True`

**Modelo venta.py - Detalle (2 tablas):**
- `Venta`: numero auto-generado, cliente opcional, metodo pago, total
- `DetalleVenta`: incluye `lote_id` → se sabe de que lote salio cada unidad vendida

---

### 4.7 schemas/ - Validacion de datos

**Ubicacion:** `backend/app/schemas/`
**Que hacen:** Definen la estructura EXACTA de los datos que entran y salen de la API.

**Por que son necesarios?**
- Si alguien envia un precio negativo → Pydantic lo rechaza automaticamente
- Si falta un campo obligatorio → Error 422 con mensaje claro
- Si el email tiene formato incorrecto → Error 422

**Patron de nombres:**
- `XxxCreate` → datos para CREAR (lo que envia el frontend)
- `XxxUpdate` → datos para ACTUALIZAR (campos opcionales)
- `XxxOut` → datos de RESPUESTA (lo que devuelve la API)

**Ejemplo concreto - ProductoCreate:**
```python
class ProductoCreate(BaseModel):
    codigo: str                    # Obligatorio
    nombre: str                    # Obligatorio
    categoria_id: int              # Obligatorio
    precio_compra: float           # Obligatorio
    precio_venta: float            # Obligatorio
    es_perecedero: bool = False    # Opcional, por defecto False

    @field_validator("precio_compra", "precio_venta")
    def precio_no_negativo(cls, v):
        if v < 0:
            raise ValueError("El precio no puede ser negativo")
        return v
```

Si alguien intenta crear un producto con `precio_compra: -100`, Pydantic devuelve:
```json
{"detail": [{"msg": "El precio no puede ser negativo", "type": "value_error"}]}
```

---

### 4.8 api/ - Los endpoints (rutas)

**Ubicacion:** `backend/app/api/`
**Que hacen:** Cada archivo define los endpoints HTTP de un modulo.

#### auth.py - Autenticacion (3 endpoints)

| Endpoint | Metodo | Que hace |
|---|---|---|
| `/api/auth/login` | POST | Recibe username+password, valida, devuelve token JWT |
| `/api/auth/register` | POST | Crea nuevo usuario (solo admin puede) |
| `/api/auth/me` | GET | Devuelve datos del usuario logueado |

**Flujo de login paso a paso:**
1. Frontend envia `{"username": "admin", "password": "********"}`
2. Backend busca usuario en BD por username
3. Compara password con hash usando bcrypt
4. Si coincide, genera token JWT con ID y rol
5. Devuelve: `{"access_token": "eyJ...", "usuario": {id, username, rol}}`

#### categorias.py - CRUD completo (5 endpoints)

| Endpoint | Metodo | Que hace |
|---|---|---|
| `/api/categorias/` | GET | Lista categorias (filtro por activa) |
| `/api/categorias/{id}` | GET | Obtiene una categoria por ID |
| `/api/categorias/` | POST | Crea categoria (valida nombre unico) |
| `/api/categorias/{id}` | PUT | Actualiza categoria |
| `/api/categorias/{id}` | DELETE | Desactiva categoria (soft delete) |

**Concepto clave - Soft Delete:**
No se borra el registro de la BD. Solo se cambia `activa = False`. Asi se conserva el historial y las relaciones con productos existentes.

#### productos.py - Catalogo (5 endpoints)

| Endpoint | Metodo | Que hace |
|---|---|---|
| `/api/productos/` | GET | Lista con filtros: activo, categoria, buscar, perecedero |
| `/api/productos/{id}` | GET | Obtiene producto con nombre de categoria |
| `/api/productos/` | POST | Crea (valida codigo unico + categoria existe) |
| `/api/productos/{id}` | PUT | Actualiza |
| `/api/productos/{id}` | DELETE | Desactiva |

#### compras.py - Registro de compras (4 endpoints)

| Endpoint | Metodo | Que hace |
|---|---|---|
| `/api/compras/` | GET | Lista compras (filtros: estado, proveedor) |
| `/api/compras/{id}` | GET | Obtiene compra con todos sus detalles |
| `/api/compras/` | POST | **CREA compra + lotes + movimientos inventario** |
| `/api/compras/{id}/anular` | POST | Anula y revierte todo el inventario |

**Que pasa al crear una compra (paso a paso):**
```
1. Validar que el proveedor exista y este activo
2. Validar que todos los productos existan y esten activos
3. Crear registro de Compra (cabecera)
4. Por cada producto en la compra:
   a. Crear DetalleCompra (producto, cantidad, costo)
   b. Crear Lote nuevo:
      - codigo_lote = "L-{compra_id}-{producto_id}"
      - cantidad_inicial = cantidad_disponible = cantidad comprada
      - fecha_ingreso = hoy
   c. Crear MovimientoInventario tipo "entrada"
   d. Actualizar precio_compra del producto
5. Calcular total de la compra
6. Guardar todo en una sola transaccion
```

#### inventario.py - Control de inventario (5 endpoints)

| Endpoint | Metodo | Que hace |
|---|---|---|
| `/api/inventario/stock` | GET | Stock actual por producto + alerta bajo stock |
| `/api/inventario/lotes` | GET | Todos los lotes (filtro: producto, disponibles) |
| `/api/inventario/alertas-vencimiento` | GET | Lotes que vencen pronto (configurable por dias) |
| `/api/inventario/movimientos` | GET | Historial completo de movimientos |
| `/api/inventario/ajuste` | POST | Ajuste manual de stock (+/-) |

**Como se calcula el stock?**
No hay un campo "stock" en la tabla productos. El stock se calcula SUMANDO la `cantidad_disponible` de todos los lotes activos (no agotados) de ese producto:
```sql
SELECT producto_id, SUM(cantidad_disponible) as stock_total
FROM lotes WHERE agotado = false GROUP BY producto_id
```

#### ventas.py - Punto de venta (4 endpoints) ★ MAS IMPORTANTE ★

| Endpoint | Metodo | Que hace |
|---|---|---|
| `/api/ventas/` | GET | Lista ventas |
| `/api/ventas/{id}` | GET | Obtiene venta con detalles |
| `/api/ventas/` | POST | **CREA venta con algoritmo FIFO** |
| `/api/ventas/{id}/anular` | POST | Anula y devuelve stock |

**Algoritmo FIFO - Explicacion detallada:**

FIFO = First In, First Out (Primero que Entra, Primero que Sale)

Cuando un cajero vende 10 kg de pechuga, el sistema descuenta automaticamente del lote MAS ANTIGUO primero:

```
Ejemplo: Vender 10 kg de Pechuga

Lotes disponibles (ordenados por fecha de ingreso):
┌─────────┬────────────────┬──────────────────┐
│ Lote    │ Fecha ingreso  │ Cantidad disp.   │
├─────────┼────────────────┼──────────────────┤
│ L-1-3   │ 2026-03-01     │ 4 kg             │  ← Mas antiguo
│ L-2-3   │ 2026-03-05     │ 8 kg             │
│ L-3-3   │ 2026-03-08     │ 15 kg            │  ← Mas reciente
└─────────┴────────────────┴──────────────────┘

Proceso FIFO para vender 10 kg:
1. Toma del Lote L-1-3: descuenta 4 kg (se agota → agotado=True)
   Faltan: 10 - 4 = 6 kg
2. Toma del Lote L-2-3: descuenta 6 kg (quedan 2 kg)
   Faltan: 6 - 6 = 0 kg ✓ COMPLETO

Resultado despues de la venta:
┌─────────┬──────────────────┬──────────┐
│ Lote    │ Cantidad disp.   │ Estado   │
├─────────┼──────────────────┼──────────┤
│ L-1-3   │ 0 kg             │ AGOTADO  │
│ L-2-3   │ 2 kg             │ Activo   │
│ L-3-3   │ 15 kg            │ Activo   │
└─────────┴──────────────────┴──────────┘
```

**Codigo clave (_descontar_fifo):**
```python
def _descontar_fifo(db, producto_id, cantidad, usuario_id, venta_id):
    lotes = db.query(Lote).filter(
        Lote.producto_id == producto_id,
        Lote.agotado == False
    ).order_by(Lote.fecha_ingreso.asc(), Lote.id.asc()).all()  # Mas antiguo primero

    restante = cantidad
    for lote in lotes:
        if restante <= 0:
            break
        descontar = min(lote.cantidad_disponible, restante)
        lote.cantidad_disponible -= descontar
        if lote.cantidad_disponible <= 0:
            lote.agotado = True
        restante -= descontar
        # Registrar movimiento de salida por cada lote tocado

    if restante > 0:
        raise HTTPException(400, "Stock insuficiente")
```

#### caja.py - Gestion de caja (4 endpoints)

| Endpoint | Metodo | Que hace |
|---|---|---|
| `/api/caja/actual` | GET | Retorna la caja abierta del usuario |
| `/api/caja/abrir` | POST | Abre caja con monto inicial |
| `/api/caja/cerrar` | POST | Cierra con arqueo (esperado vs real) |
| `/api/caja/movimiento` | POST | Registra ingreso o egreso manual |

**Flujo de arqueo al cerrar caja:**
```
Monto esperado = Monto apertura
                 + Total ventas en efectivo
                 + Total ingresos manuales
                 - Total egresos manuales

Diferencia = Monto cierre real - Monto esperado

Si diferencia > 0 → Sobrante (hay mas dinero del esperado)
Si diferencia < 0 → Faltante (hay menos dinero del esperado)
Si diferencia = 0 → Cuadra perfecto
```

#### mermas.py - Registro de perdidas (2 endpoints)

| Endpoint | Metodo | Que hace |
|---|---|---|
| `/api/mermas/` | GET | Lista mermas (filtro: producto, motivo) |
| `/api/mermas/` | POST | Registra merma + descuenta inventario |

**5 motivos de merma:**
1. **Vencimiento** - Producto paso su fecha de caducidad
2. **Dano** - Producto danado en bodega o transporte
3. **Robo** - Producto hurtado
4. **Ajuste** - Diferencia encontrada en inventario fisico
5. **Otro** - Cualquier otra razon

#### reportes.py - Reportes gerenciales (4 endpoints)

| Endpoint | Metodo | Que hace |
|---|---|---|
| `/api/reportes/ventas-diarias` | GET | Ventas del dia con totales |
| `/api/reportes/productos-mas-vendidos` | GET | Top 10 productos por cantidad vendida |
| `/api/reportes/inventario-valorizado` | GET | Stock actual x costo unitario = valor total |
| `/api/reportes/mermas-resumen` | GET | Mermas agrupadas por motivo |

#### auditoria.py - Historial de acciones (1 endpoint)

| Endpoint | Metodo | Que hace |
|---|---|---|
| `/api/auditoria/` | GET | Lista acciones con filtros: usuario, entidad, accion |

---

## 5. FRONTEND - EXPLICACION PAGINA POR PAGINA

### 5.1 api.js - El cerebro del frontend

**Ubicacion:** `frontend/static/js/api.js`
**Que hace:** Maneja TODA la comunicacion con el backend.

**Funciones principales:**

```javascript
// Guarda/lee el token JWT en localStorage del navegador
getToken()   → lee el token guardado
setToken(t)  → guarda el token
getUser()    → lee los datos del usuario logueado
setUser(u)   → guarda los datos del usuario
logout()     → borra todo y redirige al login

// Funcion principal que hace las llamadas HTTP
api(url, options)
  → Agrega automaticamente el header "Authorization: Bearer {token}"
  → Si recibe error 401 (no autorizado) → cierra sesion automaticamente
  → Devuelve la respuesta JSON

// Atajos
apiGet(url)           → api(url, {method: "GET"})
apiPost(url, body)    → api(url, {method: "POST", body: JSON.stringify(body)})
apiPut(url, body)     → api(url, {method: "PUT", body: JSON.stringify(body)})
apiDelete(url)        → api(url, {method: "DELETE"})

// Formateo
formatMoney(n)    → "$16,000" (formato colombiano)
formatDate(d)     → "09/03/2026"
formatDateTime(d) → "09/03/2026, 14:30"
```

**Deteccion inteligente de URL:**
```javascript
const configuredApiBase = window.APP_CONFIG?.API_BASE_URL?.replace(/\/$/, '') || '';
const API_BASE = `${configuredApiBase}/api`;
```
Si el frontend se sirve desde FastAPI, usa ruta relativa. Si se separa el frontend, la URL se configura desde `window.APP_CONFIG.API_BASE_URL` sin hardcodearla en el codigo base.

### 5.2 layout.js - Navegacion dinamica

**Ubicacion:** `frontend/static/js/layout.js`
**Que hace:** Renderiza el sidebar (menu lateral) filtrando opciones segun el rol del usuario.

**Como filtra por rol:**
```javascript
const menuItems = [
    {href: "index.html",       icon: "bi-speedometer2",   text: "Dashboard",    roles: null},          // Todos
    {href: "pos.html",         icon: "bi-cart3",          text: "POS",          roles: ["admin","cajero","supervisor"]},
    {href: "caja.html",        icon: "bi-cash-stack",     text: "Caja",         roles: ["admin","cajero","supervisor"]},
    {href: "reportes.html",    icon: "bi-graph-up",       text: "Reportes",     roles: ["admin","gerente","supervisor"]},
    {href: "auditoria.html",   icon: "bi-shield-check",   text: "Auditoria",    roles: ["admin","gerente"]},
    // ...
];
```
Si `roles` es `null` → lo ven todos. Si tiene una lista → solo esos roles lo ven.

Un cajero ve: Dashboard, POS, Caja, Productos, Clientes.
Un gerente ve: Dashboard, Reportes, Auditoria, Productos, Inventario.

### 5.3 style.css - Tema visual

**Ubicacion:** `frontend/static/css/style.css`
**Tema:** Verde corporativo (color principal: #2c6b3f)

**Estructura visual:**
```
┌────────────────────────────────────────────────┐
│  TOPBAR (titulo de pagina + fecha/hora)        │
├──────────┬─────────────────────────────────────┤
│          │                                     │
│ SIDEBAR  │     CONTENIDO PRINCIPAL             │
│ (250px)  │     (resto del ancho)               │
│          │                                     │
│ - Logo   │     Cards, tablas, formularios,     │
│ - Menu   │     modales, graficos...            │
│ - User   │                                     │
│          │                                     │
└──────────┴─────────────────────────────────────┘
```

**Responsive:** En pantallas pequenas (< 768px) el sidebar se oculta y aparece un boton hamburguesa para abrirlo.

### 5.4 Las 13 paginas HTML

Todas las paginas siguen el mismo patron:
```html
<!DOCTYPE html>
<html>
<head>
    <link href="bootstrap 5.3 CDN" rel="stylesheet">
    <link href="bootstrap-icons CDN" rel="stylesheet">
    <link href="static/css/style.css" rel="stylesheet">
</head>
<body>
    <div id="sidebar"></div>          <!-- Se llena con layout.js -->
    <div class="main-content">
        <div id="topbar"></div>       <!-- Se llena con layout.js -->
        <div class="container-fluid p-4">
            <!-- CONTENIDO ESPECIFICO DE CADA PAGINA -->
        </div>
    </div>

    <script src="static/js/api.js"></script>
    <script src="static/js/layout.js"></script>
    <script>
        // Codigo JavaScript especifico de cada pagina
        initPage("Titulo de la pagina");
        // Cargar datos, bindear eventos, etc.
    </script>
</body>
</html>
```

#### login.html
- Formulario centrado con logo
- Al enviar: llama a `/api/auth/login`
- Si es exitoso: guarda token + datos usuario en localStorage → redirige a index.html
- Si falla: muestra mensaje de error

#### index.html (Dashboard)
- 4 tarjetas con estadisticas del dia
- Tabla de alertas de vencimiento (proximos 7 dias)
- Tabla de productos con stock bajo
- Se actualiza al cargar la pagina

#### pos.html (Punto de Venta) - Pagina mas compleja
- **Panel izquierdo:** Buscador de productos → al escribir busca en la API → muestra resultados → al hacer clic agrega al carrito
- **Panel central:** Carrito con productos, cantidades editables, subtotales, total
- **Panel derecho:** Selector de metodo de pago, campo de cliente, boton "Finalizar Venta"
- **Panel inferior:** Ultimas 15 ventas del dia con opcion de anular

#### inventario.html - 4 tabs con Bootstrap
- Tab 1 "Stock": tabla con producto, stock actual, stock minimo, badge rojo si esta bajo
- Tab 2 "Lotes": tabla con lote, producto, cantidad, fecha ingreso, fecha vencimiento
- Tab 3 "Movimientos": historial con tipo (entrada/salida/ajuste/merma), cantidad, fecha
- Tab 4 "Alertas": lotes que vencen en X dias (configurable con input)

---

## 6. COMO SE CONECTAN FRONTEND Y BACKEND

### El servidor sirve todo junto

FastAPI sirve TANTO la API como los archivos HTML:
```python
# En main.py:

# 1. Monta archivos estaticos (JS, CSS)
app.mount("/static", StaticFiles(directory=FRONTEND_DIR / "static"))

# 2. Sirve paginas HTML
@app.get("/{page}.html")
async def serve_page(page: str):
    return FileResponse(FRONTEND_DIR / f"{page}.html")
```

Resultado: todo en un solo puerto (8000):
- `http://localhost:8000/login.html` → pagina HTML
- `http://localhost:8000/api/productos/` → datos JSON

### Flujo completo de una accion (ejemplo: crear categoria)

```
USUARIO                FRONTEND (JS)              BACKEND (FastAPI)         BASE DE DATOS
  │                        │                           │                        │
  │ Clic "Guardar"         │                           │                        │
  │───────────────────────>│                           │                        │
  │                        │ apiPost("/categorias/",   │                        │
  │                        │   {nombre: "Pollo"})      │                        │
  │                        │──────────────────────────>│                        │
  │                        │                           │ Valida con Pydantic    │
  │                        │                           │ Verifica nombre unico  │
  │                        │                           │─────────────────────> │
  │                        │                           │  INSERT INTO categorias│
  │                        │                           │<─────────────────────  │
  │                        │                           │ Devuelve JSON:         │
  │                        │<──────────────────────────│ {id:1, nombre:"Pollo"} │
  │                        │                           │                        │
  │ Muestra en la tabla    │                           │                        │
  │<───────────────────────│                           │                        │
```

### Manejo de errores

```
Si el token expira:
  Backend devuelve 401 → api.js detecta → ejecuta logout() → redirige a login

Si falta stock:
  Backend devuelve 400 con {"detail": "Stock insuficiente"} → JS muestra alerta

Si falta un campo obligatorio:
  Backend devuelve 422 con detalles del error → JS muestra que campo falta
```

---

## 7. BASE DE DATOS - LAS 15 TABLAS

### Diagrama de relaciones simplificado

```
usuarios ─────────┬──── compras ──── detalle_compras ──── productos
    │             │         │                                 │
    │             │         └──── lotes ◄─────────────────────┤
    │             │                │                           │
    │             ├──── ventas ──── detalle_ventas             │
    │             │       │                                    │
    │             │       └──── cajas ──── movimientos_caja    │
    │             │                                            │
    │             ├──── mermas ◄────────────────────────────────┤
    │             │                                            │
    │             ├──── movimientos_inventario ◄────────────────┤
    │             │                                            │
    │             └──── auditoria                              │
    │                                                          │
    └──── categorias ◄─────────────────────────────────────────┘
                                                               │
    proveedores ◄──── compras                                  │
    clientes ◄──── ventas                                      │
```

### Tabla por tabla

| # | Tabla | Campos clave | Relacion principal |
|---|---|---|---|
| 1 | `usuarios` | username, email, rol, hashed_password, activo | Padre de compras, ventas, cajas, mermas |
| 2 | `categorias` | nombre (unico), activa | Padre de productos |
| 3 | `productos` | codigo (unico), categoria_id FK, precios, es_perecedero | Hijo de categorias, padre de lotes |
| 4 | `proveedores` | nit (unico), nombre, contacto | Padre de compras |
| 5 | `clientes` | documento (unico), nombre | Referenciado en ventas |
| 6 | `compras` | proveedor_id FK, usuario_id FK, total, estado | Padre de detalle_compras y lotes |
| 7 | `detalle_compras` | compra_id FK, producto_id FK, cantidad, costo | Detalle de cada compra |
| 8 | `lotes` | producto_id FK, cantidad_disponible, fecha_vencimiento | Clave para FIFO |
| 9 | `movimientos_inventario` | producto_id FK, tipo (6), cantidad, referencia | Trazabilidad completa |
| 10 | `ventas` | numero, usuario_id FK, caja_id FK, total, estado | Padre de detalle_ventas |
| 11 | `detalle_ventas` | venta_id FK, producto_id FK, lote_id FK, cantidad | De que lote salio cada venta |
| 12 | `cajas` | usuario_id FK, monto_apertura/cierre, diferencia | Control de efectivo |
| 13 | `movimientos_caja` | caja_id FK, tipo (4), monto | Detalle de la caja |
| 14 | `mermas` | producto_id FK, motivo (5), cantidad | Registro de perdidas |
| 15 | `auditoria` | usuario_id FK, accion, entidad, detalle, ip | Log de todo |

---

## 8. LOGICA DE NEGOCIO CLAVE

### 8.1 Algoritmo FIFO (ya explicado arriba en seccion 4.8)
- Se usa en ventas para descontar stock
- Garantiza que el producto mas antiguo sale primero
- Previene que productos se venzan en bodega

### 8.2 Sistema de roles (5 niveles)

```
ADMIN ──────────── Acceso total. Crea usuarios. Ve auditoria.
  │
SUPERVISOR ─────── Casi todo. Compras, ventas, inventario, reportes.
  │
GERENTE ────────── Solo lectura. Reportes y auditoria. No opera.
  │
CAJERO ─────────── POS y caja. No ve inventario ni compras.
  │
BODEGUERO ──────── Inventario y compras. No vende ni maneja caja.
```

### 8.3 Soft Delete (borrado logico)
En vez de `DELETE FROM categorias WHERE id = 5`:
```python
categoria.activa = False
db.commit()
```
**Ventaja:** No se pierden datos historicos. Las ventas pasadas siguen referenciando la categoria.

### 8.4 Generacion automatica de numero de venta
```python
numero = f"V-{datetime.now().strftime('%Y%m%d')}-{str(venta.id).zfill(4)}"
# Ejemplo: V-20260309-0015
```

### 8.5 Transacciones atomicas
Todas las operaciones complejas (crear compra, crear venta, anular) usan transacciones:
```python
try:
    # Crear compra + detalles + lotes + movimientos
    db.commit()      # Si TODO sale bien → se guarda TODO
except:
    db.rollback()    # Si ALGO falla → se deshace TODO
```

---

## 9. DOCKER, DESPLIEGUE Y EJECUCION LOCAL

### Ejecucion local SIN Docker (modo desarrollo)

El proyecto puede ejecutarse sin Docker usando SQLite como base de datos:
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

El `.env` por defecto tiene `DATABASE_URL=sqlite:///./supermercado_avicola.db`, lo que crea un archivo de base de datos local automaticamente. El servidor crea las tablas y el usuario admin al arrancar.

**Ventajas del modo local:**
- No necesita Docker ni PostgreSQL instalado
- Ideal para desarrollo y pruebas rapidas
- La BD se crea como un archivo `.db` en la carpeta backend

**Para cambiar a PostgreSQL:** Editar `.env` y cambiar `DATABASE_URL` a:
```
DATABASE_URL=postgresql://avicola_user:avicola_pass@localhost:5432/supermercado_avicola
```

### docker-compose.yml - 2 servicios (modo produccion)

```yaml
services:
  db:                                    # SERVICIO 1: Base de datos
    image: postgres:16-alpine            # Imagen oficial de PostgreSQL 16
    environment:
      POSTGRES_USER: avicola_user
      POSTGRES_PASSWORD: avicola_pass
      POSTGRES_DB: supermercado_avicola
    volumes:
      - pgdata:/var/lib/postgresql/data  # Datos persistentes
    ports:
      - "5432:5432"

  backend:                               # SERVICIO 2: Aplicacion
    build: ../backend                    # Construye desde el Dockerfile
    ports:
      - "8000:8000"                      # Expone la API
    volumes:
      - ../frontend:/frontend            # Monta el frontend
    depends_on:
      db:
        condition: service_healthy       # Espera a que PostgreSQL este listo
    env_file: ../.env                    # Lee variables de entorno
```

### Dockerfile del backend
```dockerfile
FROM python:3.12-slim                    # Imagen base ligera
WORKDIR /app                             # Directorio de trabajo
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt  # Instala dependencias
COPY . .                                 # Copia el codigo
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
```

### Flujo de despliegue
```
1. Usuario ejecuta iniciar.bat
2. Docker Compose lee docker-compose.yml
3. Levanta PostgreSQL 16 (espera healthcheck)
4. Construye imagen del backend (Dockerfile)
5. Levanta backend conectado a PostgreSQL
6. Backend crea tablas + usuario admin al arrancar
7. Sistema listo en http://localhost:8000
```

---

## 10. TESTS Y CALIDAD

### Configuracion de tests (conftest.py)

Los tests usan **SQLite en memoria** en vez de PostgreSQL:
```python
SQLALCHEMY_TEST_URL = "sqlite://"  # Base de datos temporal en RAM
engine_test = create_engine(SQLALCHEMY_TEST_URL, ...)
```

**Ventajas:**
- No necesita PostgreSQL instalado para correr tests
- Cada test empieza con BD limpia (se crea y destruye en cada test)
- Es extremadamente rapido

### Fixture autouse (se ejecuta antes de CADA test)
```python
@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine_test)   # Crea todas las tablas
    # Crea usuario admin para que los tests puedan autenticarse
    db.add(Usuario(username="admin", ...))
    db.commit()
    yield                                         # Aqui corre el test
    Base.metadata.drop_all(bind=engine_test)     # Limpia todo
```

### Los 27 tests

**test_auth.py (9 tests):**
- Login exitoso → verifica token y datos de usuario
- Login con password incorrecta → verifica 401
- Login con usuario inexistente → verifica 401
- Obtener perfil (/me) → verifica datos
- Obtener perfil sin token → verifica 401
- Registrar usuario → verifica creacion con rol
- Registrar username duplicado → verifica 400
- Registrar sin autenticacion → verifica 401

**test_categorias.py (7 tests):**
- Crear categoria → verifica 201 y datos
- Listar categorias → verifica array con items
- Obtener categoria por ID → verifica datos
- Actualizar categoria → verifica cambio
- Desactivar categoria → verifica 204
- Nombre duplicado → verifica 400
- Categoria no existe → verifica 404

**test_productos.py (6 tests):**
- Crear producto → verifica 201, codigo, perecedero
- Listar productos → verifica array
- Buscar producto por nombre → verifica filtro
- Codigo duplicado → verifica 400
- Categoria invalida → verifica 400
- Precio negativo → verifica 422

**test_ventas.py (5 tests):**
- Crear venta completa → verifica total y estado "completada"
- Venta sin stock → verifica 400 con "insuficiente"
- Anular venta → verifica estado "anulada"
- Listar ventas → verifica array
- Venta descuenta stock → verifica que el stock baja correctamente

### Ejecutar tests
```bash
cd backend
pytest tests/ -v
```

---

## 11. PREGUNTAS FRECUENTES DE EXPOSICION

### Arquitectura y patron

**P: Que patron de arquitectura usa el proyecto?**
R: API REST con arquitectura en capas: Rutas (API) → Logica de negocio → Modelos (ORM) → Base de datos. El frontend es una SPA (Single Page Application) ligera que consume la API.

**P: Por que API REST y no MVC tradicional?**
R: REST permite separar completamente frontend y backend. El frontend puede ser una web, una app movil, o cualquier cliente HTTP. Ademas, FastAPI genera documentacion Swagger automatica.

**P: Que es un ORM y por que se usa?**
R: ORM (Object Relational Mapper) permite interactuar con la base de datos usando clases Python en vez de SQL. SQLAlchemy mapea cada tabla a una clase. Ventajas: seguridad contra SQL injection, portabilidad entre bases de datos, codigo mas legible.

### Seguridad

**P: Como se protegen las contrasenas?**
R: Se usa bcrypt para hashearlas. El hash es irreversible: no se puede obtener la contrasena original desde el hash. Al verificar, se hashea lo ingresado y se compara.

**P: Como funciona la autenticacion JWT?**
R: Al hacer login, el servidor genera un token firmado con una clave secreta. Ese token contiene el ID del usuario y su rol. En cada peticion, el frontend envia el token y el backend lo verifica. Expira en 8 horas.

**P: Que pasa si alguien modifica el token?**
R: La firma digital se invalida. El backend detecta la alteracion y rechaza el token con error 401.

**P: Como se controlan los permisos?**
R: Cada endpoint usa el decorador `require_roles()` que valida el rol del usuario. Si un cajero intenta acceder a reportes, recibe error 403 (Prohibido).

### Base de datos

**P: Por que PostgreSQL y no MySQL?**
R: PostgreSQL soporta mejor los tipos de datos complejos (enums nativos, JSON, arrays), tiene mejor manejo de concurrencia, y es mas robusto para aplicaciones empresariales.

**P: Que son las migraciones (Alembic)?**
R: Son scripts versionados que modifican la estructura de la BD. Permiten aplicar cambios de forma controlada y revertirlos si hay problemas. La migracion 001 crea las 15 tablas.

**P: Por que 15 tablas?**
R: Normalizacion. Cada entidad tiene su propia tabla para evitar redundancia. Las relaciones se manejan con Foreign Keys. Ejemplo: en vez de repetir el nombre del proveedor en cada compra, se guarda solo el proveedor_id.

### Logica de negocio

**P: Que es FIFO y por que es importante?**
R: First In, First Out. El producto que llego primero se vende primero. Es crucial para perecederos (pollo, huevos) porque evita que los lotes mas antiguos se queden en bodega hasta vencerse.

**P: Como funciona el soft delete?**
R: En vez de borrar registros, se marca un campo `activo = False`. Asi se conserva el historial. Una categoria desactivada sigue existiendo en la BD para las relaciones historicas, pero no aparece en los formularios.

**P: Que pasa al anular una venta?**
R: Se marca como "anulada" y se devuelve el stock a los lotes originales. Se registra un movimiento de inventario tipo "devolucion" para trazabilidad.

### Frontend

**P: Por que JavaScript vanilla y no React/Angular?**
R: Para simplicidad y rapidez de desarrollo. El proyecto no requiere SPA compleja. Con Bootstrap 5 + JavaScript puro se logran interfaces profesionales sin la complejidad de un framework JS.

**P: Como se comunica el frontend con el backend?**
R: Usando `fetch()` de JavaScript. El archivo `api.js` centraliza todas las llamadas HTTP y agrega automaticamente el token JWT en cada peticion.

**P: El frontend es responsive?**
R: Si. Usa Bootstrap 5 que es mobile-first. El sidebar se colapsa en pantallas pequenas y los grids se reorganizan. El CSS personalizado refuerza la responsividad.

### Docker y despliegue

**P: Que es Docker y por que se usa?**
R: Docker empaqueta la aplicacion con todas sus dependencias en un contenedor. Garantiza que funcione igual en cualquier maquina, eliminando el problema de "en mi PC si funciona".

**P: Que hace docker-compose?**
R: Orquesta multiples contenedores. En este caso levanta PostgreSQL y el backend juntos, configurando la red entre ellos automaticamente.

**P: El proyecto funciona sin Docker?**
R: Si. Se puede ejecutar directamente con `uvicorn` usando SQLite como base de datos. Solo se necesita Python 3.12+ y las dependencias de requirements.txt. Docker es para el despliegue en produccion con PostgreSQL.

**P: Por que se usa SQLite para desarrollo y PostgreSQL para produccion?**
R: SQLite no requiere instalacion (viene con Python), es ideal para desarrollo rapido. PostgreSQL es mas robusto, soporta concurrencia alta y es el estandar para aplicaciones en produccion. El codigo detecta automaticamente cual usar segun la variable DATABASE_URL.

**P: Por que se uso bcrypt directo en vez de passlib?**
R: La libreria `passlib` tiene incompatibilidad con `bcrypt >= 4.1` en Python 3.12+. Usar `bcrypt` directamente es mas estable, mas simple y sin dependencias intermedias. El resultado (hash bcrypt) es identico.

**P: Por que el claim `sub` del JWT debe ser string?**
R: Es una exigencia de la libreria `python-jose` que sigue la especificacion RFC 7519. El campo `sub` (subject) debe ser una cadena. Por eso convertimos `user.id` (int) a string al crear el token, y lo reconvertimos a int al leerlo para consultar la base de datos.

### Testing

**P: Por que SQLite en los tests y no PostgreSQL?**
R: Velocidad y simplicidad. SQLite en memoria no necesita instalacion, se crea en milisegundos, y se destruye al terminar. Para tests unitarios es suficiente.

**P: Que cobertura tienen los tests?**
R: 27 tests cubriendo los modulos criticos: autenticacion (login, registro, permisos), catalogo (categorias, productos), y ventas (creacion, FIFO, anulacion, stock). Cada test valida tanto el camino exitoso como los errores esperados.

---

## RESUMEN EJECUTIVO

| Aspecto | Detalle |
|---|---|
| Tablas en BD | 15 |
| Endpoints API | 43+ |
| Paginas frontend | 13 |
| Roles de usuario | 5 |
| Tests automatizados | 27 |
| Productos en seed | 30 (avicolas) |
| Lenguaje backend | Python 3.12+ |
| Framework backend | FastAPI |
| Base de datos | PostgreSQL 16 (produccion) / SQLite (desarrollo) |
| ORM | SQLAlchemy 2.0 |
| Framework CSS | Bootstrap 5.3 |
| Autenticacion | JWT (python-jose) |
| Contrasenas | bcrypt (directo, sin passlib) |
| Contenedores | Docker + Docker Compose |
| Migraciones | Alembic |
| Algoritmo inventario | FIFO |
| Tipo de borrado | Soft delete |
| Ejecucion local | Sin Docker, con SQLite automatico |

---

## HISTORIAL DE CAMBIOS TECNICOS

| Fecha | Cambio | Archivos afectados |
|---|---|---|
| 2026-03-09 | Proyecto completo: 6 sprints backend + frontend + tests + seeds + alembic | Todo el proyecto |
| 2026-03-09 | Soporte dual SQLite/PostgreSQL para ejecucion local sin Docker | `.env`, `config.py`, `database.py` |
| 2026-03-09 | Reemplazo passlib por bcrypt directo (compatibilidad Python 3.12+) | `security.py` |
| 2026-03-09 | Fix JWT: sub como string (exigencia python-jose/RFC 7519) | `auth.py`, `deps.py` |

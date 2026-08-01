# Supermercado Avicola

Sistema web full-stack para administrar la operacion de un supermercado avicola: autenticacion, roles, catalogo, proveedores, compras, lotes, inventario, punto de venta, caja, mermas, reportes y auditoria.

## Descripcion

Supermercado Avicola es una demo tecnica orientada a procesos reales de comercio e inventario. El backend expone una API REST con FastAPI y SQLAlchemy, usa PostgreSQL como base principal y sirve un frontend multipagina construido con HTML, Bootstrap 5 y JavaScript.

El proyecto esta preparado para ejecutarse localmente con Docker Compose o desplegarse como una sola aplicacion en Render, sirviendo frontend y backend desde FastAPI.

## Problema que resuelve

Un negocio avicola necesita controlar productos perecederos, entradas de mercancia, lotes, stock disponible, ventas, caja y trazabilidad. Este sistema centraliza esas operaciones y aplica reglas clave como salida FIFO, validacion de stock, roles de usuario y reportes operativos.

## Funcionalidades

- Login con JWT y control de acceso por roles.
- Usuarios demo para evaluacion tecnica con contrasenas ocultas en pantalla.
- CRUD de categorias, productos, proveedores y clientes.
- Registro de compras con generacion de lotes y movimientos de inventario.
- Control de inventario por stock, lotes, movimientos, ajustes y alertas de vencimiento.
- Punto de venta con carrito, validacion de stock y salida FIFO.
- Modulo de caja con apertura, cierre, ingresos, egresos y diferencia de arqueo.
- Registro de mermas con impacto en inventario.
- Reportes de ventas diarias, top productos, inventario valorizado y mermas.
- Auditoria de acciones para administradores y gerencia.
- Docker Compose para ejecucion local.
- Configuracion de despliegue en Render con PostgreSQL administrado.
- Suite de tests automatizados con SQLite en memoria.

## Tecnologias

| Capa | Tecnologias |
|---|---|
| Backend | Python 3.12, FastAPI, SQLAlchemy 2, Pydantic, Alembic |
| Base de datos | PostgreSQL 16, SQLite para tests |
| Seguridad | JWT, bcrypt, roles por endpoint, CORS por entorno |
| Frontend | HTML5, Bootstrap 5, JavaScript vanilla |
| Infraestructura | Docker, Docker Compose, Render Blueprint |
| Calidad | Pytest, TestClient, migraciones versionadas |

## Arquitectura

```text
supermercado-avicola/
|-- backend/
|   |-- app/
|   |   |-- api/          # Routers FastAPI por dominio
|   |   |-- core/         # Configuracion, seguridad, base de datos y dependencias
|   |   |-- models/       # Modelos SQLAlchemy
|   |   |-- schemas/      # Schemas Pydantic
|   |   `-- main.py       # App FastAPI y servidor de frontend
|   |-- alembic/          # Migraciones
|   |-- tests/            # Tests automatizados
|   `-- Dockerfile        # Docker local/desarrollo
|-- frontend/             # Vistas HTML, CSS y JS
|-- database/seeds/       # Datos demo
|-- docs/                 # Manuales, despliegue y capturas
|-- infra/                # Docker Compose local
|-- Dockerfile            # Imagen de produccion para Render
|-- render.yaml           # Blueprint Render
`-- .env.example          # Plantilla de variables
```

La demo publica puede correr como una sola app: FastAPI sirve `/api/*` y tambien los archivos del frontend. Esto evita separar la experiencia en dos URLs.

## Capturas

Capturas recomendadas para portafolio:

| Vista | Archivo sugerido | Objetivo |
|---|---|---|
| Login | `docs/screenshots/login.png` | Mostrar acceso demo profesional y contrasenas ocultas |
| Dashboard | `docs/screenshots/dashboard.png` | Resumen operativo y alertas |
| Inventario | `docs/screenshots/inventario.png` | Stock, lotes y vencimientos |
| Productos | `docs/screenshots/productos.png` | Catalogo, categorias, precios y estado |
| Ventas | `docs/screenshots/ventas-pos.png` | Punto de venta y carrito |
| Caja | `docs/screenshots/caja.png` | Apertura/cierre y arqueo |
| Reportes | `docs/screenshots/reportes.png` | Indicadores comerciales |

Ver la guia de captura en [docs/screenshots/README.md](docs/screenshots/README.md).

## Instalacion

### 1. Clonar el repositorio

```bash
git clone https://github.com/Andresito202/supermercado-avicola.git
cd supermercado-avicola
```

### 2. Crear variables locales

```bash
cp .env.example .env
```

En Windows tambien puedes ejecutar `iniciar.bat`; si no existe `.env`, el script lo crea desde `.env.example`.

## Variables de entorno

| Variable | Descripcion |
|---|---|
| `ENVIRONMENT` | `development`, `test` o `production` |
| `DATABASE_URL` | URL completa de PostgreSQL |
| `SECRET_KEY` | Clave privada para firmar JWT. Debe tener al menos 32 caracteres |
| `ADMIN_USERNAME` | Usuario administrador inicial |
| `ADMIN_PASSWORD` | Contrasena del administrador inicial |
| `ADMIN_EMAIL` | Email del administrador inicial |
| `CORS_ORIGINS` | Lista separada por comas de origenes permitidos |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Tiempo de expiracion del JWT |
| `AUTO_CREATE_TABLES` | Crea tablas automaticamente en desarrollo |
| `SEED_DEMO_DATA` | Carga usuarios y datos demo al iniciar |
| `FRONTEND_DIR` | Ruta opcional para servir frontend desde FastAPI |

Las claves sensibles no tienen valores por defecto en el codigo. Deben configurarse por entorno. En produccion no se permite `CORS_ORIGINS=*` ni claves de ejemplo.

## Docker

### Desarrollo local

```bash
cd infra
docker compose up --build
```

Servicios:

- App: `http://localhost:8000`
- Swagger: `http://localhost:8000/docs`
- PostgreSQL: `localhost:5432`

### Produccion

El Dockerfile de la raiz esta pensado para Render:

```bash
docker build -t supermercado-avicola .
docker run --env-file .env -p 8000:8000 supermercado-avicola
```

## Base de datos

El proyecto usa PostgreSQL en desarrollo y produccion. Para tests se usa SQLite en memoria.

Migraciones:

```bash
cd backend
alembic upgrade head
```

Seed demo:

```bash
python database/seeds/seed_data.py
```

Usuarios demo del seed:

| Rol | Usuario |
|---|---|
| Administrador | `admin` |
| Cajero | `cajero1` |
| Bodeguero | `bodeguero1` |
| Supervisor | `supervisor1` |
| Gerente | `gerente1` |

Las contrasenas demo se ocultan visualmente en el login y se copian mediante botones.

## Tests

```bash
cd backend
python -m pytest tests -q
```

Estado actual validado:

```text
27 passed
```

## Despliegue

La configuracion recomendada es Render:

- Web Service Docker en plan `starter` para evitar sleep en entrevistas.
- PostgreSQL administrado por Render en plan `basic-256mb`.
- Variables sensibles en el panel de Render.
- Frontend servido desde FastAPI.

El repositorio incluye `render.yaml` para crear la infraestructura base. Ver pasos detallados en [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Para una demo sin costo se pueden cambiar los planes a `free`, aceptando cold starts, limites y menor estabilidad para reclutadores.

## Roadmap

- Agregar pagina de administracion de usuarios.
- Completar auditoria automatica en todas las operaciones criticas.
- Agregar GitHub Actions para ejecutar tests en cada push.
- Reemplazar renderizados con `innerHTML` por componentes DOM seguros en todo el frontend.
- Agregar capturas reales al README y Open Graph para LinkedIn.
- Agregar filtros avanzados y exportacion CSV/PDF en reportes.

## Autor

Wilson Andres Camacho Culma

Proyecto preparado como demo full-stack para entrevistas tecnicas, portafolio personal y seccion Destacados de LinkedIn.

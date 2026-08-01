# Despliegue en Render

Esta guia prepara una demo publica de Supermercado Avicola usando una sola URL: FastAPI sirve el frontend y la API.

## Arquitectura de despliegue

- Plataforma: Render
- Servicio web: Docker, plan `starter`, region `oregon`
- Base de datos: PostgreSQL 16 administrado, plan `basic-256mb`, region `oregon`, acceso publico cerrado
- Frontend: servido por FastAPI desde `/frontend`
- API: rutas bajo `/api`

## Opcion recomendada: Render Blueprint

1. Subir los cambios a GitHub.
2. Entrar a Render.
3. Crear un nuevo Blueprint desde el repositorio.
4. Render detectara `render.yaml`.
5. Configurar manualmente la variable `ADMIN_PASSWORD`.
6. Crear el servicio.

La configuracion usa planes minimos de produccion para evitar sleep durante entrevistas. Para pruebas sin costo se pueden cambiar los planes a `free`, aceptando cold starts y menor estabilidad.

## Variables requeridas

| Variable | Valor recomendado |
|---|---|
| `ENVIRONMENT` | `production` |
| `DATABASE_URL` | Generada por Render PostgreSQL |
| `SECRET_KEY` | Generada por Render o valor seguro de 32+ caracteres |
| `ADMIN_USERNAME` | `admin` |
| `ADMIN_PASSWORD` | Contrasena demo definida en Render |
| `ADMIN_EMAIL` | `admin@avicola.demo` |
| `CORS_ORIGINS` | URL publica del servicio Render. No usar `*` |
| `AUTO_CREATE_TABLES` | `false` |
| `SEED_DEMO_DATA` | `true` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `480` |

## Comando de arranque

El Dockerfile raiz ejecuta:

```bash
alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
```

## Verificacion post-deploy

1. Abrir `https://TU-SERVICIO.onrender.com/api/health`.
2. Confirmar respuesta:

```json
{
  "status": "ok",
  "project": "Supermercado Avicola"
}
```

3. Abrir `https://TU-SERVICIO.onrender.com/login.html`.
4. Copiar usuario y contrasena demo desde el login.
5. Iniciar sesion.
6. Revisar Dashboard, Inventario, POS, Caja y Reportes.

## Nota sobre CORS

Si el frontend se sirve desde el mismo FastAPI, `CORS_ORIGINS` debe apuntar a la URL publica de Render. La configuracion de produccion rechaza `*`.

Si en el futuro se separa frontend y backend, agregar tambien el dominio del frontend a `CORS_ORIGINS`, separado por coma.

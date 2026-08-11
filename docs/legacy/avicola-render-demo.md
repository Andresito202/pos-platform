# Demostración heredada de Supermercado Avícola en Render

## Estado

Histórico. No normativo para POS Platform.

## Propósito conservado

La línea base Avícola podía publicarse como una demostración de una sola URL donde FastAPI servía el frontend estático y la API. Esta guía se conserva para reproducir o inspeccionar el legado durante la migración.

No es una guía de producción y no puede procesar datos reales.

## Componentes heredados

- FastAPI;
- SQLAlchemy y Alembic;
- frontend HTML/JavaScript estático;
- Dockerfile raíz heredado;
- PostgreSQL cuando se configura externamente;
- Blueprint `render.legacy-demo.yaml`.

## Uso permitido

- demostración con datos sintéticos;
- comparación funcional durante migración;
- pruebas manuales del legado;
- extracción de reglas que deban reconciliarse;
- evidencia histórica.

## Uso prohibido

- clientes reales;
- datos personales o comerciales reales;
- piloto productivo;
- facturación electrónica productiva;
- presentación como POS Platform terminado;
- afirmación de alta disponibilidad, backup, recuperación o SLA;
- reutilización de credenciales de otro entorno.

## Despliegue manual de la demo

Render no debe detectar automáticamente este Blueprint como configuración productiva. Para una prueba aislada, el operador debe seleccionar explícitamente:

```text
render.legacy-demo.yaml
```

Antes de desplegar debe confirmar:

1. que no existen datos reales;
2. que las credenciales pertenecen al entorno de demo;
3. que el servicio no comparte base ni secretos con staging, piloto o producción;
4. que el costo y las limitaciones de la instancia son aceptables para la prueba;
5. que el servicio se eliminará o suspenderá cuando deje de ser necesario.

## Variables heredadas

| Variable | Uso histórico |
|---|---|
| `DATABASE_URL` | Conexión de la demo |
| `SECRET_KEY` | Firma de tokens del legado |
| `ADMIN_PASSWORD` | Usuario administrativo de demo |
| `CORS_ORIGINS` | Origen público de la demo |
| `AUTO_CREATE_TABLES` | Debe permanecer deshabilitado en despliegue |
| `SEED_DEMO_DATA` | Solo datos sintéticos y mediante acción explícita |

Ninguna de estas variables define el contrato futuro de secretos, identidad o despliegue.

## Comando heredado

El Dockerfile raíz heredado ejecuta conceptualmente:

```text
alembic upgrade head
uvicorn app.main:app
```

Este comando no debe copiarse al backend NestJS ni convertirse en el pipeline de migración objetivo.

## Migración

La eliminación futura de esta guía y del Blueprint requiere:

- reemplazo funcional de la línea base;
- migración y reconciliación de datos definida;
- ausencia de dependencias documentales activas;
- decisión explícita de retirar el legado.

Hasta entonces se mantiene fuera de la ruta productiva y claramente etiquetado como histórico.

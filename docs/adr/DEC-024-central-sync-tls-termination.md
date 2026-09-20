# DEC-024 — Terminación TLS de la autoridad central de sincronización

Estado:

`PROPOSED`

Fecha:

`2026-09-16`

Relacionada con:

- `DEC-007` — HTTPS obligatorio para el transporte central;
- `DEC-008` — confianza de dispositivo y canal;
- `DEC-009` — baseline operativo de producción;
- `DEC-010` — runtime POS;
- `PR #78` — transporte saliente y autoridad central.

## Problema

`SyncDispatcher` exige una URL central `https://` y el contrato exige TLS con validación normal de certificados. La autoridad central implementada actualmente escucha mediante `node:http`, por lo que todavía no existe un camino ejecutable entre ambos extremos.

La auditoría del repositorio no encontró una infraestructura existente de nginx, Caddy, Traefik, HAProxy, certificados o ACME que resuelva esta diferencia.

## Decisión propuesta

La terminación TLS debe estar fuera del proceso de autoridad de negocio, mediante un reverse proxy de producción administrado por infraestructura.

Flujo objetivo:

```text
POS Local Service
      │
      │ HTTPS + validación normal del certificado
      ▼
Reverse Proxy TLS
      │
      │ HTTP privado / loopback
      ▼
central-sync-server
      │
      ▼
PostgreSQL
```

## Reglas

1. `SyncDispatcher` mantiene `https://` obligatorio.
2. No se habilita HTTP como alternativa para el cliente.
3. No se deshabilita la validación de certificados.
4. No se implementa certificate pinning como sustituto de la PKI normal.
5. La clave privada del certificado nunca entra al repositorio ni a la instalación POS.
6. El proceso `central-sync-server` debe quedar accesible solo desde la infraestructura interna del servicio cuando se materialice el despliegue.
7. El reverse proxy termina TLS y reenvía únicamente al endpoint de sync autorizado.
8. La gestión de certificados queda en infraestructura (renovación, permisos, rotación y monitoreo), no en el dominio ni en el cliente POS.
9. El token de sincronización continúa siendo autenticación de aplicación; TLS no lo sustituye.
10. No se marca D-2/D-3 como operable hasta demostrar una conexión HTTPS real contra la autoridad PostgreSQL real.

## Por qué no TLS directo en `central-sync-server`

El servidor podría cargar `key`/`cert` con `node:https`, pero eso trasladaría al proceso de negocio la lectura, permisos, rotación y ciclo de vida de certificados. `DEC-009` exige una operación profesional del backend central y de su infraestructura; separar la terminación TLS mantiene esa responsabilidad fuera del código de negocio.

La elección no implica introducir una dependencia concreta todavía: Caddy, nginx u otro reverse proxy compatible pueden materializar esta frontera. La implementación debe respetar las mismas invariantes.

## No resuelto todavía

- dominio DNS real de la autoridad;
- proveedor/host de producción;
- reverse proxy concreto;
- mecanismo de emisión y renovación de certificados;
- secreto real de `CENTRAL_SYNC_TOKEN`;
- identidad/credencial real del dispositivo (`DEC-008` sigue pendiente).

Por lo anterior este ADR es `PROPOSED` y no eleva ningún gate de producción.

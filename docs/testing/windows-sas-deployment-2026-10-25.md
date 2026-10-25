# SAS Windows tras aprobación del propietario — 2026-10-25

Base local/remota: `78fd96298c7e3cbc5aed3cfa5307390764c279b8`, única rama
`feat/android-commercial-runtime`; PR #96 sigue draft. No se toca el directorio
concurrente `docs/product/oracleJdk-27/`.

## Aprobación y alcance

Respuesta expresa «si autorizado» a la solicitud SAS/access-refresh que citaba
la propuesta única y la continuidad P0. Aprueba implementación de esos contratos,
sin inventar raíces, certificados, plazos, despliegue o personas. No cubre por
inferencia el lock global SQL, registro de migraciones o producción operativa.

Se materializa primero el contrato SAS y su bootstrap, sin reconstruir identidad,
PKCE, SSA, permisos ni diseño. Access/refresh productivo **no está completado por
esta publicación**: su autorización de implementación ya existe y no se vuelve
a pedir la misma aprobación; faltan su wire, persistencia/binding de familia,
renovación/abuso y montaje sobre los transportes canónicos.

## Código alcanzable

`CAMACHO_SAS_TRUST_V1`, modo DEPLOYMENT y environment PREPRODUCTION/PRODUCTION
son un contrato separado de `DEC011_LAB_CANDIDATE_1`. Comparten primitivas de
validación e historial, pero no se convierten sobres LAB. El conjunto completo
firma también recipient con tenant/empresa/sucursal/instalación/dispositivo;
ninguno se deriva de React. Firma Ed25519 sobre JSON canónico. El firmante offline
Central exige clave privada suministrada por el custodio y sólo emite material
público. No se crea ni se sirve una raíz privada desde un endpoint.

`POS_AUTHORIZATION_TRUST_PROVISION_FILE` es una ruta absoluta en la configuración
administrada del Service. Sin ella el runtime conserva confianza SAS ausente.
Con ella, main prepara el adapter; el lifecycle lo instancia después de abrir
SQLite y LocalSecurityComponent, antes de CommercialComponent. Se comprueba el
binding completo y el issuer contra la configuración local. Verifica raíz pública
Ed25519 y huella SPKI SHA-256 explícita; exige protección OS_BOUND.

El adapter lee un archivo **público firmado**, valida el perfil y root, instala
todo el conjunto de forma atómica en el store DPAPI existente y lo reverifica en
cada consumo. Usa el scheduler existente para releer actualizaciones. No se añade
un canal renderer, una API de firma ni un endpoint de provisión administrativa.
La actualización del archivo por el instalador no concede autoridad por sí sola:
requiere la firma root y las comprobaciones monotónicas. Se recomienda reemplazo
atómico del archivo por el operador.

Generación, historial acumulado y tombstones se conservan. Se corrige el avance
del bootstrap floor: el conjunto anterior por debajo del nuevo mínimo deja de
autorizar pero conserva historial para validar una renovación superior. Cambiar
root sin transición autenticada no permite resetear ese historial: deniega.
La **rotación automática de raíz no está implementada**; no se debe borrar el
store para conseguirla. La rotación operacional mediante manifiesto firmado sí
reutiliza el mecanismo existente.

## Datos del operador, sin secretos en Git o chat

El archivo de provisión es un JSON estricto, sin defaults productivos:

| Campo | Procedencia y condición |
| --- | --- |
| version | 1, versión del formato de provisión |
| environment | PREPRODUCTION o PRODUCTION según entorno real |
| issuer / authority_id | Registro de autoridad auténtico; issuer exacto HTTPS igual a POS_CENTRAL_BASE_URL |
| recipient | Los cinco IDs canónicos del contexto confiable instalado, no creados manualmente para saltar DEV-003 |
| minimum_generation | Piso público vigente obtenido del custodio por canal independiente |
| root_public_key_pem / root_spki_sha256 | Sólo raíz pública Ed25519 y huella verificada fuera del canal de entrega |
| artifact_path | Ruta absoluta al conjunto completo root-signed destinado a ese recipient |
| refresh_interval_ms | Cadencia explícita aprobada para el despliegue; mínimo técnico 1.000 ms, sin valor productivo preseleccionado |
| clock_rollback_tolerance_ms | Tolerancia explícita aprobada; no se toma por defecto la de otro componente |

El instalador/operador debe proteger con ACL tanto configuración como raíz,
archivo y directorio DPAPI para la cuenta del Service/administrador autorizado.
La huella en el mismo archivo detecta errores; su autenticidad procede del canal
administrativo y la comparación independiente, no de esa coincidencia local.
Este código no acredita quién es el operador ni administra esas ACL de Windows.

Renovación materializada por archivo administrado. Descarga HTTPS autenticada,
publicación remota del manifiesto y provisión administrativa remota quedan
pendientes del protocolo access/refresh y del despliegue auténtico; no se usa el
token LAB ni se declara una nueva autoridad de autenticación.

## Validación local y límites

Pruebas de DPAPI/SQLite temporal, contrato/despliegue, falsificación, destinatario
incorrecto, replay de generación, root distinta, cancelación, expiración y
floor elevado. Proceso main real en NODE_ENV=production arranca y reinicia con
provisión PREPRODUCTION y claves efímeras de prueba. Eso verifica composición
Windows; no es despliegue productivo ni certificación humana.

Comandos reproducibles y resultados finales se conservan en
`windows-sas-deployment-evidence-2026-10-25.json`. Se revalida sólo lo afectado:
store/refinamientos compartidos, configuración, bootstrap y un E2E Electron con
custodia Service. Sin suites comerciales/Argon2id/MFA independientes.

Pendientes operativos: autoridad/operador HTTPS auténticos, registros y claves
DEV-003, parámetros explícitos, control administrativo de provisión/root,
access/refresh completo, adopción SQL y certificación con persona/autenticador.
Ningún fixture se instala como identidad comercial. CI pendiente por orden del
propietario; no se consulta ni despacha Actions, no se modifican workflows.

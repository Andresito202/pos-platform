# Matriz de verificación de consentimiento y base jurídica — Camacho POS Colombia

**Versión:** 1.0  
**Fecha:** 2026-10-07  
**Alcance:** producto POS local-first y sus flujos actualmente materializados.

## 1. Regla de control

El producto no debe pedir un consentimiento genérico como requisito automático para cualquier tratamiento de datos personales.

Antes de tratar un dato se debe identificar:

1. el dato y su finalidad;
2. si la finalidad es necesaria para ejecutar una operación o cumplir una obligación legal;
3. si existe otra base jurídica aplicable;
4. si el tratamiento depende realmente de una autorización del titular;
5. si esa autorización puede retirarse sin afectar un tratamiento que deba continuar por obligación legal;
6. qué evidencia debe conservarse para demostrar la decisión.

**Regla de fail-closed:** cuando una funcionalidad sí requiera autorización y no exista evidencia verificable de ella, la funcionalidad opcional no debe ejecutarse ni debe sustituirse la autorización por una aceptación implícita.

## 2. Flujos actuales

| Flujo | Datos principales | Finalidad | ¿Consentimiento como condición? | Verificación materializada |
|---|---|---|---|---|
| Registro de adquiriente para operación/facturación | identificación y datos fiscales | identificar al tercero y soportar la operación comercial/fiscal | **No por defecto**; debe aplicarse la base jurídica que corresponda a la finalidad concreta | validación fiscal + permiso de operador + aislamiento por compañía |
| Contacto opcional del adquiriente | correo/teléfono | comunicación comercial o contacto no indispensable para la operación | **Sí cuando la finalidad concreta dependa de autorización** | no se declara una autorización implícita por el simple registro |
| Administración de dispositivo | datos técnicos/identidad de dispositivo | administración autorizada del dispositivo | **Sí**, cuando el flujo está clasificado como `DEVICE_MANAGED` o `KIOSK_MANAGED` | consentimiento y contrato explícitos según `UC-DEV-001` |
| Seguridad, auditoría y trazabilidad | identificadores técnicos y evidencia mínima | seguridad, prevención de abuso, auditoría y cumplimiento | **No por defecto** cuando otra base jurídica habilite el tratamiento | auditoría append-only y controles de acceso |
| Cookies/seguimiento web | — | — | **N/A** en la aplicación Electron/local-first actual | no existe superficie web de cookies materializada |
| Marketing/newsletter (`POS_NEWS`) | correo, identificador de cliente y evidencia de autorización | envío futuro de novedades del POS por correo | **Sí**: opt-in explícito antes de activar la suscripción | suscripción local materializada; persiste versión `1.0`, fecha/hora, origen `POS`, actor/sesión y auditoría mínima; permite consulta y baja. No existe despachador de campañas externas, por lo que no se declara envío de correos materializado |

## 3. Verificación en la captura de adquirientes

El alta de un adquiriente **no debe incorporar un checkbox genérico de privacidad para aparentar cumplimiento**.

La pantalla puede capturar datos fiscales necesarios para la operación sin convertir esa captura en una autorización comercial general.

Si se añade una finalidad opcional que requiera autorización —por ejemplo, comunicaciones comerciales— deberá introducirse como una capacidad separada y explícita, con:

- finalidad concreta;
- texto de autorización identificable;
- versión de la política/aviso aplicable;
- fecha y hora;
- evidencia del origen de la autorización;
- posibilidad de retiro;
- no reutilización de una autorización para otra finalidad.

Hasta que esa capacidad exista, el producto **no debe afirmar que posee un registro de consentimiento comercial**.

## 4. Verificación de dispositivos

`UC-DEV-001` ya exige consentimiento y contrato explícitos para `DEVICE_MANAGED` y `KIOSK_MANAGED`. Esa regla permanece como control obligatorio y no se relaja mediante este documento.

El consentimiento de administración del dispositivo no se reutiliza como consentimiento para marketing, tratamiento de datos de clientes ni otras finalidades.

## 5. Retiro y revocación

Retirar una autorización sólo afecta las finalidades que dependan de ella.

No debe provocar eliminación automática de registros que deban conservarse por obligaciones fiscales, contables, de seguridad o auditoría. La solicitud se tramita conforme a `docs/legal/data-subject-rights-procedure.md`.

## 6. Evidencia y límites

Esta matriz demuestra que existe una clasificación explícita de consentimiento frente a otras bases jurídicas; **no declara que el producto tenga un gestor universal de consentimientos**, porque esa capacidad no existe.

No se crea una tabla, evento o endpoint de consentimiento genérico sin una finalidad real que lo necesite. Hacerlo ahora produciría almacenamiento de evidencia sin una semántica de negocio definida.

## 7. Implementación de novedades del POS

La captura de adquiriente incluye un opt-in separado para `POS_NEWS` por correo. La autorización no se deriva del simple registro fiscal: el renderer sólo solicita la suscripción si el checkbox fue marcado; también existe una acción explícita de suscripción desde la ficha del adquiriente. El servicio persiste estado, versión `1.0`, fecha/hora de consentimiento, origen `POS`, actor/sesión y auditoría mínima. El cliente puede consultar su estado y darse de baja. La baja cambia el estado a `UNSUBSCRIBED` y conserva la evidencia mínima necesaria; no borra el registro fiscal.

La capacidad de **envío externo de correo/campañas** no se declara materializada por este bloque: el repositorio no tenía proveedor de correo, credenciales ni endpoint público de baja. La preferencia queda operativa y bloquea la elegibilidad para futuras campañas hasta que exista un despachador central autorizado. Un proveedor como Resend soporta contactos, bajas automáticas y encabezados `List-Unsubscribe`, pero su adopción requiere configuración explícita del Responsable y dominio/proveedor. citeturn4search1turn4search0

## 8. Criterio de cierre

El bloque de «verificar consentimientos» se considera **materializado como control de gobernanza y verificación de base jurídica**, mientras no exista una funcionalidad de producto que requiera capturar autorizaciones adicionales.

Si aparece una nueva finalidad que dependa de consentimiento, su implementación debe ser un bloque separado: contrato, persistencia de evidencia, captura explícita, retiro, sincronización y pruebas antes de declararla operativa.

**Fuente única:** este documento + `docs/legal/privacy-policy.md` + `docs/use-cases/devices/UC-DEV-001-manage-device-lifecycle.md`.
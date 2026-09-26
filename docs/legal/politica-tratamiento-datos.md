# Política de Tratamiento de Datos Personales — Camacho POS Colombia

> **BORRADOR — DOCUMENTED únicamente. No publicar sin revisión de abogado colombiano y sin completar los campos [PENDIENTE].**
> Este texto no es asesoría legal. Fue redactado a partir del estado del repositorio en la rama
> `feat/payment-qr-provider-foundation` el 2026-09-26 y de normas consultadas ese mismo día
> (ver §14). Cada afirmación sobre el producto cita el fichero que la respalda.

`Camacho POS Colombia` es el nombre comercial del producto. **No es una marca registrada**
(`docs/product/brand.md:10`, `Registro marcario SIC: NOT_REGISTERED`); en este documento se usa
sólo como nombre descriptivo.

---

## 1. Responsable del Tratamiento

| Campo (Decreto 1377 de 2013, art. 13 num. 1) | Valor |
|---|---|
| Nombre o razón social | [PENDIENTE — razón social del responsable] |
| NIT | [PENDIENTE — NIT del responsable] |
| Domicilio y dirección física | [PENDIENTE — domicilio y dirección física del responsable] |
| Correo electrónico para asuntos de datos personales | [PENDIENTE — correo de contacto de protección de datos] |
| Teléfono | [PENDIENTE — teléfono de contacto] |
| Persona o área que atiende consultas y reclamos (Decreto 1377 de 2013, arts. 13 num. 4 y 23) | [PENDIENTE — persona o área responsable de protección de datos] |

En adelante, «**la Plataforma**» designa a ese responsable en su calidad de proveedor del
software, y «**el Comercio**» a cada empresa cliente que instala y usa el software para vender.

## 2. Los dos papeles de la Plataforma (Responsable y Encargado)

La Ley 1581 de 2012 distingue al **Responsable** («decida sobre la base de datos y/o el
Tratamiento», art. 3 lit. e) del **Encargado** («realice el Tratamiento … por cuenta del
Responsable», art. 3 lit. d). Si una misma persona reúne ambas calidades, le son exigibles los
deberes de cada una (art. 18, parágrafo). La Plataforma ocupa los dos papeles, sobre datos
distintos:

| Papel | Sobre qué datos | Quién decide la finalidad |
|---|---|---|
| **Responsable** | Datos de sus propios clientes y usuarios: cuentas de usuario del Comercio (dueños, administradores, cajeros), credenciales, sesiones, eventos de seguridad y auditoría de acceso, datos de contacto de la empresa cliente y de sus sedes. | La Plataforma |
| **Encargado** | Datos que **cada Comercio** recoge sobre **sus** clientes finales: adquirientes registrados para facturación, cuentas de crédito del cliente, destinatarios de facturas electrónicas, correo del pagador devuelto por la pasarela de pagos. | El Comercio, que es el Responsable frente a sus clientes |

Consecuencia práctica: un cliente final de un Comercio que quiera conocer, corregir o suprimir sus
datos **debe dirigirse primero al Comercio**. Si la solicitud llega a la Plataforma, ésta la
traslada al Comercio y lo asiste como Encargado (ver `derecho-supresion.md` §4). Ley 1581 de
2012, art. 15 num. 1: quien no sea competente «dará traslado a quien corresponda en un término
máximo de dos (2) días hábiles e informará de la situación al interesado».

La relación Comercio–Plataforma como Encargado debe constar en un contrato de transmisión con el
contenido mínimo del Decreto 1377 de 2013, art. 25: [PENDIENTE — modelo de contrato de transmisión
Comercio–Plataforma].

## 3. Declaración: qué datos personales recopilamos

**Declaramos que el software recopila y almacena datos personales.** La lista siguiente se obtuvo
leyendo los esquemas de base de datos y el código del repositorio; no incluye categorías que el
código no maneja. Las columnas exactas se citan en `README.md` §«Inventario de datos personales».

### 3.1 Datos de los que la Plataforma es Responsable

| Categoría | Datos | Dónde vive (evidencia) |
|---|---|---|
| Identidad del usuario del Comercio | correo electrónico, teléfono (opcional), nombre completo, estado; nombre de usuario por comercio para cajeros y supervisores | Central: `identity.users` (`tools/target-migrations/sql/postgres/001_central_foundation.up.sql:28-34`). Modelo: `docs/architecture/conceptual-data-model.md:717-745`. **Cambio autorizado, no aplicado:** `DEC-026` §13.4 hace el correo opcional y añade el nombre de usuario por comercio mediante la migración PostgreSQL 005 |
| Credenciales | verificador de contraseña (hash con sal, nunca la contraseña), intentos fallidos, bloqueo, fechas | Central: `identity.user_credentials` (`001_central_foundation.up.sql:136`). Regla de hash: `conceptual-data-model.md:769` |
| Segundo factor (MFA) | tipo de factor, referencia al secreto, fechas | Central: `identity.mfa_factors` (`001_central_foundation.up.sql:158`) |
| Sesiones | identificadores de sesión, dispositivo, vigencia | Central: `identity.sessions` (`001_central_foundation.up.sql:257`); local: `local_session_assertion` (`packages/database-sqlite/src/local-database.ts:228`) |
| Eventos de seguridad | usuario, sesión, código y resultado del evento, **dirección IP** (opcional), fecha | Central: `identity.security_events` (`001_central_foundation.up.sql:307-316`), append-only (`:598`) |
| Auditoría de acciones | actor (usuario), acción, recurso, valores anterior/nuevo, correlación | Central: `audit.audit_events` (`001_central_foundation.up.sql:438`), append-only (`:604-607`); local: `local_operation_audit` (`local-database.ts:161`), append-only (`:184`, `:303`) |
| Datos de la empresa cliente | razón social, NIT, correo, teléfono; nombre y dirección de sedes | Central: `organization.companies` y `organization.branches` (`001_central_foundation.up.sql:60-90`). Son datos de persona jurídica; pueden ser personales si el Comercio es persona natural |
| Personal interno de la Plataforma | correo, teléfono, estado, nivel de seguridad, último ingreso | Modelo: `PlatformAccount` (`conceptual-data-model.md:23-34`) |

### 3.2 Datos de los que la Plataforma es Encargado (el Comercio es Responsable)

| Categoría | Datos | Dónde vive (evidencia) |
|---|---|---|
| Adquiriente / cliente del Comercio | tipo y número de documento de identificación, dígito de verificación, nombres o razón social, tipo de organización, responsabilidades tributarias, correo, teléfono, dirección, país y municipio | Local: `customers_customers` (`local-database.ts:912-934`); viaja al servicio central por el outbox (`apps/pos-local-service/src/customers/sqlite-customer-store.ts:280-309`) |
| Crédito del cliente | cuenta de crédito (cupo, moneda) y movimientos (ventas a crédito, abonos) | Local: `customers_credit_accounts` (`local-database.ts:1468`) y `customers_credit_transactions` (`local-database.ts:1499`) |
| Vínculo venta–cliente | a quién se vendió | `sales_sales.customer_id` (`local-database.ts:1412-1414`) |
| Factura electrónica | el cuerpo completo enviado al proveedor fiscal, que incluye los datos del adquiriente; CUFE | Local: `fiscal_electronic_document.payload_json` (`local-database.ts:1684`, `:1696`), inmutable (`:1756`); adquiriente enlazado (`:2294`) |
| Pagador por QR/pasarela | correo del pagador **si la pasarela lo devuelve** | `wompi-transaction.ts:26`, `:86-87`; se escribe en auditoría y outbox (`apps/pos-local-service/src/payments/sqlite-payment-store.ts:1240-1245`) |

### 3.3 Lo que el software NO recopila (a la fecha del borrador)

- **No almacena datos de tarjeta.** El pago por pasarela redirige al pagador a la página alojada
  de Wompi (`apps/pos-local-service/src/payments/wompi/wompi-checkout-builder.ts:34`); el POS sólo
  envía referencia, monto y moneda (`:65-71`).
- **No hay analítica ni telemetría de terceros.** Ninguna dependencia de ejecución del producto es
  un SDK de analítica (`apps/*/package.json`, `packages/*/package.json`); los únicos hosts externos
  en el código son Wompi y Factus (ver `terceros-y-encargados.md` §3).
- **No hay geolocalización implementada.** El requisito `RNF-PRV-001`
  (`docs/product/non-functional-requirements.md:141`) prevé geolocalizar al domiciliario sólo
  durante operaciones autorizadas; el módulo de domicilios no existe en código.
- **No se tratan datos sensibles** (Ley 1581 de 2012, art. 5) de forma deliberada: ningún campo del
  esquema está destinado a salud, biometría, origen étnico, etc. Los campos de texto libre (nombre,
  dirección) no deben usarse para ello.
- **No se usa inteligencia artificial sobre datos personales** (ver `declaracion-uso-ia.md`).

## 4. Finalidades del Tratamiento

Cada finalidad corresponde a una función que el código implementa o que la arquitectura exige.

| Finalidad | Datos | Papel |
|---|---|---|
| Autenticar usuarios y controlar su acceso por empresa, sede y rol | identidad, credenciales, MFA, sesiones | Responsable |
| Seguridad, detección de abuso e investigación de incidentes | eventos de seguridad (incluida IP), auditoría | Responsable |
| Atribuir cada operación comercial al usuario que la hizo (trazabilidad) | auditoría de acciones | Responsable |
| Prestar el servicio contratado, licenciar y dar soporte | datos de la empresa cliente y de contacto | Responsable |
| Registrar al adquiriente para emitir factura electrónica por cuenta del Comercio | datos del adquiriente | Encargado |
| Transmitir la factura electrónica al proveedor tecnológico habilitado | cuerpo de la factura | Encargado |
| Llevar el crédito que el Comercio concede a su cliente | cuenta y movimientos de crédito | Encargado |
| Confirmar pagos recibidos por pasarela | referencia, id de transacción, correo del pagador si llega | Encargado |
| Sincronizar la operación local con el servicio central (modalidad `HYBRID`) | los anteriores, según operación | Encargado / Responsable |

No se tratan los datos para publicidad, perfiles comerciales, venta a terceros ni entrenamiento de
modelos. Cualquier finalidad nueva exige actualizar esta política y, si cambia la finalidad,
obtener nueva autorización (Decreto 1377 de 2013, art. 5, inciso 3).

## 5. Autorización

- **Usuarios del Comercio (Plataforma Responsable):** la autorización se obtiene al crear la cuenta
  por el medio que permita consulta posterior (Ley 1581 de 2012, art. 9; Decreto 1377 de 2013,
  arts. 7 y 8). [PENDIENTE — texto y mecanismo de autorización en el alta de cuenta; el alta de
  cuenta no está implementada: `DEC-026` la fija como política, `docs/adr/DEC-026-sec-g02-authentication-factors.md:3-8`].
- **Clientes finales (Comercio Responsable):** obtener y conservar la autorización del cliente
  final es deber **del Comercio** (Ley 1581 de 2012, art. 17 lit. b). El software **no muestra hoy
  ningún texto de autorización** al registrar un adquiriente. [PENDIENTE — decidir si el POS debe
  ofrecer al Comercio un aviso/constancia de autorización al registrar un cliente].
- Casos sin autorización: los del art. 10 de la Ley 1581 de 2012 (p. ej. información requerida
  por entidad pública en ejercicio de sus funciones legales).

## 6. Derechos del Titular

Conforme a la Ley 1581 de 2012, art. 8, el Titular puede:

a) conocer, actualizar y rectificar sus datos;
b) solicitar prueba de la autorización;
c) ser informado, previa solicitud, del uso dado a sus datos;
d) presentar quejas ante la Superintendencia de Industria y Comercio (SIC), una vez agotado el
   trámite ante el Responsable o Encargado (art. 16);
e) revocar la autorización y/o solicitar la supresión del dato;
f) acceder gratuitamente a sus datos — al menos una vez por mes calendario y cada vez que cambie
   sustancialmente esta política (Decreto 1377 de 2013, art. 21).

Nota para revisión legal: el texto del art. 8 lit. e) de la Ley 1581 condiciona la revocatoria o
supresión a una determinación de la SIC, mientras el Decreto 1377 de 2013, art. 9, permite
solicitarla «en todo momento» mediante reclamo. Este borrador sigue el decreto; el abogado debe
confirmar la lectura. [PENDIENTE — validación legal de la relación art. 8 lit. e) Ley 1581 / art. 9 Decreto 1377].

Pueden ejercer los derechos el Titular (acreditando identidad), sus causahabientes, su
representante o apoderado, o por estipulación a favor de otro (Decreto 1377 de 2013, art. 20).

## 7. Procedimiento para consultas y reclamos

**Canal:** [PENDIENTE — correo de contacto de protección de datos] y [PENDIENTE — otro canal
gratuito, p. ej. formulario o dirección física]. Los mecanismos deben ser gratuitos y de fácil
acceso (Decreto 1377 de 2013, art. 9, inciso 3).

**Consultas** (Ley 1581 de 2012, art. 14): se responden en máximo **diez (10) días hábiles** desde
su recibo. Si no es posible, se informa el motivo y la nueva fecha, que no puede superar **cinco
(5) días hábiles** adicionales.

**Reclamos** — corrección, actualización, supresión o incumplimiento (Ley 1581 de 2012, art. 15):

1. La solicitud debe incluir identificación del Titular, descripción de los hechos, dirección y
   los documentos que quiera hacer valer.
2. Si está incompleta, se pide subsanar dentro de los **cinco (5) días** siguientes; si pasan
   **dos (2) meses** sin respuesta del solicitante, se entiende desistido.
3. Si quien lo recibe no es competente (p. ej. el dato pertenece a un Comercio), lo traslada en
   máximo **dos (2) días hábiles** e informa al interesado.
4. Recibido completo, se marca «reclamo en trámite» en máximo **dos (2) días hábiles**.
5. Se resuelve en máximo **quince (15) días hábiles** desde el día siguiente al recibo; prorrogable
   informando motivos, hasta **ocho (8) días hábiles** más.

Estado técnico: el software **no tiene aún** una función para marcar un registro como «reclamo en
trámite» ni para exportar los datos de un Titular. Hasta que exista, el trámite se hace de forma
manual y documentada. [PENDIENTE — procedimiento manual interno y responsable de ejecutarlo].

## 8. Supresión y sus límites

El Titular puede pedir la supresión (Decreto 1377 de 2013, art. 9). **La supresión no procede
cuando el Titular tiene un deber legal o contractual de permanecer en la base de datos** (mismo
artículo, inciso 2; compilado en el Decreto 1074 de 2015, art. 2.2.2.25.2.6). Además, los datos
deben conservarse cuando lo exija una obligación legal o contractual (Decreto 1377 de 2013,
art. 11).

En este producto eso significa, en particular:

- Las **facturas electrónicas** y los **registros contables y de caja** del Comercio no se borran:
  el Comercio debe conservar sus libros y papeles durante diez años (Ley 962 de 2005, art. 28) y
  los soportes tributarios durante el término de firmeza de la declaración (Ley 962 de 2005,
  art. 46, modificado por la Ley 1819 de 2016, art. 304). El cuerpo de la factura queda congelado
  en disco (`local-database.ts:1756`).
- Los **registros de auditoría y de seguridad** son append-only por diseño
  (`001_central_foundation.up.sql:598-607`; `local-database.ts:184`, `:303`) y el modelo exige
  retenerlos o archivarlos conforme a política (`conceptual-data-model.md:2770-2790`).
- El `User` no se borra: «se desactiva; la privacidad o anonimización es un proceso separado y
  auditado» (`conceptual-data-model.md:2775`).

Lo que sí procede, cuando no hay deber de conservación, es la eliminación o la **anonimización**
de los datos personales. El procedimiento está en `derecho-supresion.md`. **Advertencia: el
mecanismo técnico de anonimización todavía no existe** y está pendiente de decisión de arquitectura
(`DEC-027`).

## 9. Retención

Los datos se conservan sólo el tiempo razonable y necesario para la finalidad, atendiendo aspectos
contables, fiscales y jurídicos (Decreto 1377 de 2013, art. 11). El requisito interno
`RNF-PRV-002` (`non-functional-requirements.md:143`) exige que cada dato personal tenga finalidad,
retención y control de acceso definidos; **esos plazos aún no están definidos**
(`conceptual-data-model.md:774`: «la duración concreta pertenece a la política de
retención y no se inventa en el modelo»).

| Categoría | Plazo |
|---|---|
| Cuentas de usuario activas | mientras dure la relación contractual |
| Credenciales y MFA retirados | [PENDIENTE — plazo de retención de credenciales retiradas (`retained_until`)] |
| Eventos de seguridad y auditoría | [PENDIENTE — plazo de retención de auditoría y eventos de seguridad] |
| Datos del Comercio al terminar el servicio | [PENDIENTE — plazo de exportación y eliminación al terminar el servicio (`RNF-PRV-004`)] |
| Documentos fiscales y contables | según el deber legal del Comercio (§8); [PENDIENTE — plazo concreto validado por contador/abogado] |
| Vigencia de las bases de datos (Decreto 1377 de 2013, art. 13 num. 6) | [PENDIENTE — período de vigencia de las bases de datos] |

## 10. Terceros y circulación de datos

La lista de terceros que reciben datos, con finalidad, datos y estado de implementación, está en
`terceros-y-encargados.md`. Resumen: Factus (facturación electrónica) y Wompi (pagos) tienen
código; Siigo y Alegra sólo están documentados; **no se usa analítica de terceros**; el proveedor
de alojamiento del servicio central **no está decidido**.

**Transferencia y transmisión internacional.** Si el servicio central se aloja fuera de Colombia,
el envío de datos será una **transmisión** si el receptor actúa como Encargado, o una
**transferencia** si actúa como Responsable (Decreto 1377 de 2013, art. 3 nums. 4 y 5). La
transferencia a países sin nivel adecuado de protección está prohibida salvo las excepciones de la
Ley 1581 de 2012, art. 26; la transmisión con contrato conforme al art. 25 del Decreto 1377 no
requiere informar al Titular (art. 24 num. 2). [PENDIENTE — proveedor de alojamiento y país] y
[PENDIENTE — calificación transferencia/transmisión internacional].

## 11. Medidas de seguridad

Se describen sólo las que el repositorio evidencia. **Esto no es una certificación ni una promesa
de nivel de servicio.**

- Credenciales de proveedores (Factus, Wompi) cifradas en el equipo con AES-256-GCM
  (`apps/pos-local-service/src/security/encrypted-secret-store.ts:53`) y clave protegida por DPAPI
  de Windows (`windows-dpapi-key-provider.ts`); una prueba verifica que el valor no queda en claro
  (`docs/governance/tablero-materializacion.md`, fila C17).
- Contraseñas: el modelo exige guardar sólo un hash resistente con sal (`conceptual-data-model.md:769`).
  La función de hash existe (scrypt con parámetros OWASP,
  `apps/api/src/authentication/password-hasher.ts`), pero el inicio de sesión con
  contraseña **no está implementado** todavía: no hay endpoint ni persistencia (`DEC-026` §13–§14).
- Registros de auditoría y seguridad append-only (ver §8).
- Registro de errores con redacción de secretos (tokens, contraseñas, credenciales)
  (`packages/observability/src/structured-logger.ts:1-25`). **La redacción no cubre datos
  personales** como correo o número de identificación.
- Aislamiento por tenant y control de permisos por operación (principios de `CLAUDE.md`,
  «Principios no negociables»).
- Sin contraseña maestra ni acceso de soporte permanente; el acceso de soporte debe ser temporal y
  auditado (`docs/security/secret-key-and-support-management.md:263`; `RNF-PRV-003`). Diseñado, no
  verificado en ejecución.

Limitación conocida: **la base de datos local SQLite no está cifrada en reposo**; no se ha
seleccionado mecanismo de cifrado (`secret-key-and-support-management.md:205-221`). La protección
física del equipo depende del Comercio.

Incidentes de seguridad: se informará a la SIC cuando se presenten violaciones a los códigos de
seguridad y existan riesgos para los Titulares (Ley 1581 de 2012, arts. 17 lit. n y 18 lit. k).
[PENDIENTE — procedimiento y plazo interno de notificación de incidentes, incluido aviso al Comercio].

## 12. Niños, niñas y adolescentes

El tratamiento de sus datos está proscrito salvo datos de naturaleza pública y con los requisitos
del Decreto 1377 de 2013, art. 12. El software no distingue la edad del adquiriente.
[PENDIENTE — regla operativa para el Comercio cuando el adquiriente sea menor de edad].

## 13. Registro Nacional de Bases de Datos (RNBD)

Deben inscribir sus bases en el RNBD las sociedades y entidades sin ánimo de lucro con activos
totales superiores a 100.000 UVT y las personas jurídicas de naturaleza pública (Decreto 1074 de
2015, art. 2.2.2.26.1.2, modificado por el Decreto 090 de 2018, art. 1). **Es una obligación a
evaluar, no un trámite hecho.** [PENDIENTE — evaluación de obligación RNBD según activos del
responsable]. Quien no esté obligado sigue sujeto a los demás deberes de la Ley 1581 (concepto SIC
citado en §14).

## 14. Vigencia y fuentes

- Fecha de entrada en vigencia: [PENDIENTE — fecha de entrada en vigencia].
- Publicación: [PENDIENTE — URL o medio de publicación de la política].
- Los cambios sustanciales se comunicarán antes de implementarse (Decreto 1377 de 2013, arts. 5 y 13).

Normas consultadas el **2026-09-26**:

| Norma | URL |
|---|---|
| Ley 1581 de 2012 | https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=49981 |
| Decreto 1377 de 2013 | https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=53646 |
| Decreto 1074 de 2015, art. 2.2.2.25.2.6 (compila art. 9 Decreto 1377) | https://normograma.sena.edu.co/compilacion/docs/decreto_1074_2015_pr026.htm y https://www.cancilleria.gov.co/sites/default/files/Normograma/docs/decreto_1074_2015_pr025.htm |
| Decreto 090 de 2018 (RNBD) | https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=85039 |
| Concepto SIC 22-300986 (obligados RNBD) | https://sedeelectronica.sic.gov.co/publicaciones/boletin-juridico/concepto/cuales-personas-estan-obligadas-realizar-el-registro-de-bases-de-datos-personales-en-el-rnbd |
| Ley 962 de 2005, arts. 28 y 46 | http://www.secretariasenado.gov.co/senado/basedoc/ley_0962_2005.html |

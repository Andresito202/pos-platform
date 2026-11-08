# Capacidad de cajas V2

Incremento sobre e32011b6. Sin cambios visuales ni claves productivas.

El contrato estricto CAMACHO_LICENSE_CAPACITY_V2 conserva los bindings de
licencia y añade versión, plan y asignaciones explícitas register_id/branch_id.
Incluye exactamente una caja; admite hasta 10000 adicionales declaradas en el
artefacto firmado. La suma de asignaciones nunca supera 1 + paid_additional.
Las licencias V1 no adquieren un cupo implícito. No se cuentan dispositivos.

El verificador criptográfico existente verifica ambos contratos por entradas
separadas. El gate usa activación y auditoría SQLite existentes, transacción
IMMEDIATE y watermark durable por instalación. Rechaza versiones anteriores,
contenido diferente con la misma versión y sustitución de licencia sin un
protocolo de reemplazo. No borra suspensiones ni revocaciones al renovar.

El main real del Service instala el gate antes de abrir CashShift. Sin
POS_LICENSE_CAPACITY_PROVISION_FILE deniega LICENSE_CAPACITY_NOT_PROVISIONED.
El archivo absoluto administrado por el instalador contiene sólo claves
públicas Ed25519 con fingerprint, estado y artefacto firmado; se relee por
operación para observar revocaciones. No es un endpoint de provisión y no acepta
claves desde React/main IPC. El instalador debe proteger su ACL. Las claves de
licencia se provisionan separadamente de SSA/SAS/DeviceTrust. No se proporcionó
ninguna raíz o licencia real. No se infiere estado de red: el gate exige vigencia
actual y no concede gracia offline por una política supuesta.

Pruebas locales: capacity-final.json, 6 PASS (4 nuevas criptografía/SQLite,
1 integración de denegación/apertura CashShift y 1 regresión V1 afectada).
Incluyen exceso/duplicación, firma, binding completo, expiración, revocación de
clave, suspensión, reapertura real de SQLite, replay/versiones, rollback de
activación cuando falla auditoría y preservación del permiso CASH_SHIFT_OPEN.
Fixtures de claves efímeras y bases temporales: no certificación productiva.

TypeScript contracts/Service, build:artifact win32-x64, ARCH-003 y política PASS.
Artefacto Service observado SHA256
3399908a4027895cf6735301ad2b0573cb2766fd69f4d54c8d1e298be02a968a.

Pendiente interno: productor central que derive paid_additional de un pago
canónico confirmado, serialice la asignación global entre instalaciones y firme
desde Licensing. Este incremento no prueba ni declara ese productor, transporte
de distribución ni compra real. No se firma capacidad desde una selección React.
La integración local es exigible; el flujo de venta/activación completo aún no.

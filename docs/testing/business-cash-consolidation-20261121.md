# Consolidación BUSINESS y cajas 2026-11-21

El propietario autorizó continuar la rama existente `codex/business-cash-consolidation-20261120`, preservar el trabajo local sobre `3471d39f`, confirmar/publicar el bloque validado e integrar mediante PR y CI del commit exacto. No se afirma una revisión humana del diff que no haya sido observada.

## Bloque conservado

Central monta `/v1/business/` en el listener HTTPS original y sirve el mismo renderer `index.html` en `/business/`. Login BEGIN/COMPLETE reutiliza password/WebAuthn, recibos internos de un solo uso y sesiones existentes. Cookie BUSINESS y GLOBAL, permisos y contextos permanecen separados. Sesión, contextos, logout y listar/crear/editar/retirar cajas pasan por la autoridad existente. No se instala provisión ni se activa una sesión por este commit.

La creación conserva intención/correlación en el panel y confirma reintentos desde auditoría inmutable en la transacción de la mutación. La retención del panel es en memoria; recargar requiere reconciliar la lista. El registro empresarial reutiliza InitializeTenant y muestra organización/membresía confirmadas; READY_FOR_LICENSE no significa credenciales, MFA o licencia provisionados.

## Evidencia observada antes de publicar

| Comprobación | Resultado y límite |
|---|---|
| business-router.test.ts | 19 PASS; HTTPS loopback con certificado efímero, router/handlers/emisor/autoridad reales; MFA y PostgreSQL son dobles |
| business-browser-session.test.ts | 17 PASS; unitarias, sin PostgreSQL |
| BusinessCashRegisterPanel.test.tsx y PlatformTenantRegistration.test.tsx | 3 PASS; jsdom con cliente/transporte doblados |
| initialize-tenant.test.ts | 6 PASS; repositorio doblado |
| TypeScript | PASS Central, desktop, contracts, application, database-postgres y pos-local-service |
| Renderer | Compilación PASS a carpeta temporal nueva; dist existente preservado; dos advertencias de anotaciones PURE en Zod |
| git diff --check | PASS |

Los 45 casos son únicos; ejecuciones repetidas no se suman. Este nivel es TESTED local, no RUNTIME_VERIFIED, CALLER_REACHABLE, END_TO_END ni PRODUCTION.

## Pendientes de cierre

- PostgreSQL 16 escucha en 5432, pero no hubo conexión autorizada en la sesión. Ledger/checksums 029–032, grants, RLS/FORCE RLS, SQL real, auditoría, sesiones y concurrencia no fueron comprobados. No se usó 55433 ni se ejecutaron migraciones.
- El bloqueo de varias licencias del primer bloque se resuelve en el sucesor 033 descrito debajo; su aplicación al entorno comercial sigue pendiente de acceso autorizado.
- Falta verificar provisión HTTPS, claves reales, WebAuthn humano, distribución firmada al dispositivo y arranque comercial. No se generan sustitutos en producción.
- La integración a main sigue sujeta a los gates del HEAD exacto y a la verificación post-merge, aunque la publicación esté autorizada.

El respaldo `C:\Respaldos\CamachoPOS\codex-20261120-190306` tenía 37 copias legibles e iguales por SHA-256 antes de continuar. Su parche sufrió recodificación; no se restauró. No contiene un respaldo integral de datos o secretos. Los archivos de datos, DPAPI, cachés y `.claude-desactivado/` permanecen excluidos.


## Sucesor 033 y correcciones de CI

`licensing.cash_register_bindings` cubre una relación ausente: 022 exige un
dispositivo/credencial para una activación, mientras que 029 permite crear el
maestro antes de elegir dispositivo. La reserva pertenece a Licensing y el
maestro sigue perteneciendo a Cash. No se modifica ninguna migración histórica.

La clave primaria por caja impide dos licencias; la FK compuesta preserva
empresa/sucursal. La capacidad pagada se serializa con el mismo advisory lock
`license-capacity:<licenseId>` usado por `LicenseCapacityAuthority`, con índice
por licencia. La reserva es inmutable, tiene FORCE RLS y se conserva al retirar o
revocar: este bloque no inventa un protocolo de liberación offline. El backfill
usa las activaciones históricas y la auditoría inmutable de creación. Un maestro
faltante o una historia incompatible aborta la migración, sin elegir licencia
arbitrariamente. Las cajas antiguas sin evidencia de licencia siguen sin reserva;
GLOBAL puede reservarlas explícitamente al asignar capacidad, dentro del contrato
original y la misma transacción auditada.

BUSINESS valida la licencia seleccionada contra el pago/quote de su empresa;
crear reserva en la misma transacción que maestro y auditoría. Listar excluye
reservas de otras licencias; editar y retirar rechazan la licencia incompatible.
El panel distingue licencias con igual nombre mediante su identificador
confirmado por el servidor. GLOBAL reutiliza la reserva al asignar dispositivos.
Una activación PENDING no puede obtener una firma nueva si entretanto se retiró
el maestro. Los artefactos previamente emitidos conservan su historial.

El arranque BUSINESS exige checksums 032/033 en su provisión; el arranque de
licencias exige además `binding_migration_checksum` para 033. Ambos rechazan una
provisión/esquema incompletos. No se ejecutan migraciones durante el arranque.
La CLI original incorpora `--cash-register-bindings`; `--manifest` solamente lee
el SQL y calcula su hash. En el entorno comercial hay que inspeccionar primero
ledger/checksums 029–032 e historia, sin reaplicarlos automáticamente.

Se restauró el `OperationPanel` original y la etiqueta accesible `Ver billetes y
monedas` tras cuatro fallos concretos de CI. No se retiraron aserciones.
También se corrigió el uso de FOR SHARE sobre quote/payment_group inmutables,
cuyos grants originales no permiten UPDATE; licencia y pago mutable permanecen
bloqueados y no se amplían permisos SQL.

El contenedor de pruebas original usaba --rm y desapareció al apagar Windows.
Se recreó únicamente `camacho-binding-test-20261121`, imagen local postgres:16.14,
loopback 61111 y TLS con CA efímera verificada. No sustituye camacho_pos:5432.
No se borraron contenedores, imágenes o volúmenes existentes. La base desechable
de cada prueba se crea con nombre UUID y se elimina al terminar; nunca se usa
una URL por defecto ni el puerto comercial. Los errores iniciales del fixture
(preflight de roles/TLS, parámetros UUID/text y contrato de salida) se corrigieron
sin reducir invariantes del runner ni aserciones del producto.

### Resultados focalizados del sucesor

- `postgres-033-bindings.test.ts`: 5 PASS en PostgreSQL 16.14 aislado,
  TLS verificado y rol `pos_platform_app`. Incluye runner/ledger real, concurrencia
  por último cupo, licencias independientes, inmutabilidad/retiro, FORCE RLS,
  grants, y el caso de uso BUSINESS real mediante un proceso de prueba. Ese
  proceso comprueba crear/replay/editar/conflicto/retirar, tres auditorías reales
  y rechazo del maestro retirado antes de una nueva firma. La sesión es fixture
  aislado; no acredita un login humano ni la base comercial.
- `business-router.test.ts`: 20 PASS, transporte/router reales con fronteras
  PostgreSQL y MFA dobladas. No se suman a los 19 históricos como casos nuevos.
- `App.test.tsx` y `SalePanel.test.tsx`: 45 PASS al restaurar las cuatro
  regresiones. Tras el hallazgo de revisión, SalePanel pasa 33 casos, incluido
  subtotal estimado antes de recibir el total pagadero del servicio.
- `BusinessCashRegisterPanel.test.tsx`: 4 PASS con cliente doblado; selección de
  licencias homónimas, corrección tras primer rechazo HTTP definitivo e intención
  conservada después de una respuesta incierta, incluso si después llega 409.
- Typecheck Central, target-migrations y desktop: PASS. ARCH-003 y política del
  repositorio: PASS. El gate CI incorpora las dos pruebas backend focalizadas
  contra el HEAD publicado; la integración sigue condicionada a su resultado.

Los dos hallazgos P2 de revisión se corrigieron: el carrito sin venta confirmada
se rotula como subtotal sin impuestos/redondeo; el cliente distingue rechazos
HTTP definitivos de resultados inciertos. Un rechazo posterior a una respuesta
perdida no demuestra que el primer intento no se haya confirmado y por eso
conserva la intención. No se redujeron aserciones para obtener estos resultados.

El propietario confirmó que la configuración comercial autorizada aún no está
 disponible. No se conectó camacho_pos, no se ejecutó 033 allí, no se crearon claves
ni sesiones comerciales provisionales y no se abrió otro POS para aparentar
operación. La validación del ledger/historia comercial, login humano, recepción
firmada y arranque oficial quedan pendientes de esa infraestructura.

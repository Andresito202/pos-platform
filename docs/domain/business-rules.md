# Reglas de negocio

## Empresas y aislamiento

RN-001. Todo dato operativo debe pertenecer a un tenant y a una empresa.

RN-002. Ningún usuario puede consultar o modificar información de otro tenant.

RN-003. Los datos de una sucursal solo pueden consultarse desde otra sucursal cuando el rol y la política de la empresa lo permitan.

RN-004. El contexto de tenant, empresa y sucursal debe validarse en backend.

## Usuarios y seguridad

RN-005. Los permisos no dependen de botones ocultos en frontend.

RN-006. Los cambios críticos requieren reautenticación y segundo factor cuando corresponda.

RN-007. El cajero no puede modificar configuración fiscal, QR de recaudo, licencias, permisos ni costos.

RN-008. Las cuentas administrativas no pueden compartirse.

RN-009. Toda acción sensible debe quedar auditada.

## Productos y precios

RN-010. Un producto puede tener varios códigos de barras.

RN-011. El precio aplicado a una venta debe conservarse como snapshot.

RN-012. Un cambio posterior de precio no modifica ventas ya confirmadas.

RN-013. El cajero no puede cambiar libremente el precio.

RN-014. Los precios deben manejar vigencia e historial.

RN-015. El dinero no debe manejarse con punto flotante binario.

## Inventario

RN-016. El stock no se modifica directamente; cambia mediante movimientos.

RN-017. Cada movimiento debe tener tipo, cantidad, origen, responsable y fecha.

RN-018. Los productos perecederos deben consumirse mediante FEFO cuando exista vencimiento.

RN-019. Los productos sin vencimiento pueden usar FIFO u otra política configurada.

RN-020. Los productos vencidos no pueden venderse salvo una excepción explícita, autorizada y auditada.

RN-021. Los ajustes manuales requieren motivo.

RN-022. Las existencias se controlan por sucursal.

## Ventas

RN-023. Una venta confirmada no se elimina físicamente.

RN-024. Una venta se corrige mediante anulación o devolución.

RN-025. La confirmación de venta debe registrar de forma atómica venta, detalles, pagos, inventario, caja y auditoría.

RN-026. Repetir una solicitud de confirmación no debe crear ventas duplicadas.

RN-027. La impresión fallida no debe eliminar ni revertir una venta confirmada.

RN-028. La facturación electrónica no debe bloquear ni perder la venta comercial.

RN-029. Una venta en efectivo requiere una caja abierta, salvo configuración explícita autorizada.

RN-030. La base inicial de caja no constituye una venta.

## Caja

RN-031. Una caja abierta debe estar asociada a sucursal, terminal, usuario y turno.

RN-032. Un usuario no puede tener dos turnos de caja abiertos en la misma terminal.

RN-033. El cierre referencia un CashCount inmutable que conserva corte de movimientos, versión de cálculo, valor esperado, valor contado, diferencia, denominaciones y política aplicada.

RN-034. Los cierres no se eliminan.

RN-035. Toda apertura manual de cajón debe auditarse.

RN-036. Los pagos no efectivos no incrementan el efectivo físico esperado.

## Recepción y compras futuras

RN-037. Confirmar un GoodsReceipt debe crear sus líneas, asignaciones de lote y un movimiento de entrada por asignación de forma atómica con costo histórico, saldo, auditoría y outbox.

RN-038. Un GoodsReceipt confirmado no se anula, edita ni elimina; una corrección o devolución al proveedor crea una operación compensatoria nueva, valida disponibilidad y conserva la recepción original.

RN-039. El precio de venta no cambia automáticamente por una recepción ni por su costo declarado.

RN-040. El costo de recepción debe conservar unidad, moneda, tratamiento tributario conocido, conversión, instante y actor/fuente, separado de costo contable, valoración y precio de venta.

## Domicilios

RN-041. Un pedido aceptado debe reservar inventario.

RN-042. Un pedido cancelado debe liberar la reserva.

RN-043. El domiciliario no puede modificar QR, cuentas ni medios de recaudo.

RN-044. Una captura de pantalla no confirma un pago.

RN-045. El QR estático mostrado debe pertenecer al negocio o sucursal.

RN-046. La entrega requiere PIN válido de un solo uso.

RN-047. El seguimiento GPS solo estará activo durante el pedido.

RN-048. Las ventas por domicilio y punto físico deben conservar su canal de origen.

## Licencias

RN-049. Las modalidades `HYBRID` y `LOCAL_PERPETUAL` comparten la misma base de código.

RN-050. La suspensión por falta de pago debe aplicar avisos y periodo de gracia únicamente cuando exista política autorizada.

RN-051. No se eliminan datos por falta de pago, expiración, suspensión, revocación o cambio de modalidad.

RN-052. Los módulos y límites se controlan mediante derechos verificables y validación autoritativa en backend cuando exista conectividad.

RN-053. La licencia local perpetua no incluye automáticamente actualizaciones mayores.

RN-054. La licencia es distinta de la activación, la sesión, el dispositivo y los permisos del usuario.

RN-055. Una activación no amplía derechos ni límites contractuales.

RN-056. El cliente no modifica localmente vigencia, módulos, límites, gracia, revocaciones ni estado contractual.

RN-057. La clave privada central nunca reside en el cliente.

RN-058. Manipular un payload firmado invalida su verificación.

RN-059. Una firma inválida no genera periodo de gracia.

RN-060. Una clave desconocida no se acepta por conveniencia ni fallback.

RN-061. La identidad del dispositivo no depende exclusivamente de una huella de hardware.

RN-062. Un dispositivo revocado no recupera confianza sin autorización explícita.

RN-063. El reloj local no constituye autoridad temporal absoluta.

RN-064. Cambiar el reloj, reinstalar o restaurar una copia local no extiende licencia ni reinicia gracia.

RN-065. La ausencia de conectividad no crea derechos, activaciones, gracia ni reactivaciones.

RN-066. Una revocación conocida se aplica también durante operación offline.

RN-067. Una revocación no elimina ventas, pagos, inventario, caja, auditoría ni operaciones pendientes.

RN-068. La activación online y offline debe conservar identidad, idempotencia, vínculo con dispositivo e instalación y evidencia verificable.

RN-069. Una respuesta de activación offline no puede reutilizarse en otro dispositivo o instalación.

RN-070. El reemplazo de dispositivo conserva trazabilidad y no copia la clave privada anterior.

RN-071. La recuperación sin clave anterior exige controles reforzados y revocación de la identidad previa cuando corresponda.

RN-072. Una actualización debe verificar firma, integridad, plataforma, compatibilidad y política de versión antes de instalarse.

RN-073. Una actualización no amplía derechos ni elimina datos confirmados.

RN-074. Un downgrade inseguro debe bloquearse.

RN-075. Los errores de licencia, activación, dispositivo, tiempo y revocación deben usar códigos estables y no mensajes ambiguos.

RN-076. Toda emisión, activación, revocación, reemplazo, recuperación, rotación y acceso de soporte debe quedar auditado.

RN-077. La política normativa de confianza de dispositivo, licencia firmada y activación se define en `DEC-008`.

## Comprobantes

RN-078. Los datos impresos deben corresponder a la empresa y sucursal de la venta.

RN-079. Una reimpresión debe reproducir el snapshot original.

RN-080. CUFE, QR fiscal y resolución solo se imprimen cuando existen datos válidos de integración fiscal.

RN-081. La reimpresión debe quedar auditada.

## Dispositivos y administración operativa

RN-082. El estado operativo de un dispositivo es distinto de su estado de confianza criptográfica, estado de licencia, activación y estado contractual.

RN-083. Los estados operativos conceptuales del dispositivo son `ACTIVE`, `OFFLINE`, `STALE`, `UNREACHABLE`, `DEGRADED`, `DEACTIVATED` y `REVIEW_REQUIRED`.

RN-084. Un dispositivo `STALE` no se considera automáticamente revocado, comprometido, desinstalado ni fuera de servicio.

RN-085. Un dispositivo `UNREACHABLE` indica ausencia de comunicación dentro de la política aplicable, pero no constituye por sí solo evidencia suficiente de desinstalación.

RN-086. La desinstalación solo puede considerarse confirmada mediante evidencia explícita y auditable; la ausencia de heartbeat o sincronización no equivale a `UNINSTALL_CONFIRMED`.

RN-087. `last_seen_at` y `last_sync_at` representan evidencias diferentes: actividad conocida del dispositivo y última sincronización confirmada respectivamente.

RN-088. La pérdida de heartbeat, conectividad o sincronización debe generar estado operativo y alertas según política, pero no debe eliminar datos ni revocar automáticamente licencia, dispositivo o activación.

RN-089. Una reinstalación genera una nueva identidad de instalación y debe evaluarse contra el dispositivo, clave, activaciones y evidencia previa antes de autorizar operación.

RN-090. Una reinstalación sospechosa debe producir revisión o alerta verificable y no puede utilizarse para reiniciar gracia, evadir suspensión, recuperar una activación revocada ni ampliar derechos.

RN-091. La propiedad física del equipo y el nivel de administración del POS son dimensiones independientes y deben modelarse explícitamente.

RN-092. Los modos conceptuales de propiedad del activo son `CUSTOMER_OWNED`, `PROVIDER_OWNED`, `LEASED` y `MANAGED_ASSET`.

RN-093. Los modos conceptuales de administración son `SOFTWARE_ONLY`, `SOFTWARE_MANAGED`, `DEVICE_MANAGED` y `KIOSK_MANAGED`.

RN-094. Las capacidades administrativas efectivas sobre un dispositivo deben limitarse por contrato, modalidad del activo, consentimiento, permisos y política de seguridad aplicable.

RN-095. En equipos propiedad del cliente, el sistema no puede bloquear el sistema operativo, impedir la instalación de software de terceros ni ejercer controles ajenos al POS únicamente para forzar permanencia comercial o cobro.

RN-096. En equipos administrados, arrendados o provistos bajo modalidad que autorice gestión reforzada, cualquier control técnico adicional debe estar explícitamente autorizado, ser proporcional, auditable y limitarse al alcance contractual definido.

RN-097. La suspensión contractual del POS puede restringir capacidades licenciadas según la política autorizada, pero no debe destruir datos comerciales ni impedir su conservación, recuperación o tratamiento conforme a las reglas aplicables.

RN-098. La desactivación, desinstalación, revocación, pérdida de comunicación, recuperación y reemplazo de un dispositivo deben conservar historial y trazabilidad.

RN-099. El sistema administrativo puede generar alertas por dispositivo `STALE`, `UNREACHABLE`, reinstalación sospechosa, desinstalación confirmada, revocación, cambio relevante de hardware o pérdida de identidad criptográfica.

RN-100. Una alerta administrativa constituye evidencia para revisión y no autoriza por sí sola una acción destructiva, una ampliación de privilegios ni una revocación irreversible.

RN-101. La política operativa de dispositivos debe respetar aislamiento por `tenant_id`, empresa y sucursal, y ninguna señal de actividad de un tenant puede utilizarse para autorizar acciones sobre otro.

RN-102. El ciclo de vida operativo del dispositivo se define en `UC-DEV-001` y debe permanecer compatible con la política criptográfica y de activación definida en `DEC-008`.

## Ciclo de vida y estado de licencias

RN-103. `contract_status` representa únicamente estado contractual y no debe mezclar vigencia temporal, gracia, revocación, restricción efectiva ni validez criptográfica.

RN-104. Los valores conceptuales de `contract_status` son `TRIAL`, `ACTIVE`, `PAST_DUE`, `SUSPENDED`, `CANCELLED` y `TERMINATED`.

RN-105. `EXPIRED` representa un resultado temporal de evaluación derivado de vigencia y no un estado contractual persistente.

RN-106. `GRACE_PERIOD` representa una decisión efectiva sustentada por una `GraceAuthorization` válida y vigente.

RN-107. `RESTRICTED` representa una decisión efectiva de autorización y no un `contract_status` base.

RN-108. `REVOKED` representa el resultado efectivo de una `LicenseRevocation` aplicable y no un `contract_status`.

RN-109. `INVALID` representa un resultado de validación criptográfica, estructural o normativa y no un estado contractual.

RN-110. La autorización efectiva de licencia debe calcularse combinando estado contractual, vigencia, entitlements, gracia, activación, dispositivo, revocaciones, política offline y versión aplicable.

RN-111. Los avisos de vencimiento son señales comerciales versionadas y no cambian por sí solos derechos, vigencia ni estado contractual.

RN-112. La suspensión contractual puede restringir capacidades licenciadas, pero no debe revocar automáticamente dispositivos ni eliminar datos.

RN-113. Una reactivación contractual debe ser explícita y no puede ampliar derechos ni revivir revocaciones de dispositivo.

RN-114. Una licencia `LOCAL_PERPETUAL` conserva los derechos contratados para su alcance definido y no incluye automáticamente actualizaciones mayores ni servicios externos adicionales.

RN-115. El cambio de plan debe generar una nueva decisión autoritativa y versionada sin eliminar datos existentes por reducción de derechos o límites.

RN-116. `UC-LIC-002` define el ciclo de vida contractual-operativo de licencia y debe permanecer compatible con `UC-LIC-001` y `DEC-008`.
RN-117. `UC-DEV-002` define el contrato operativo entre identidad del POS, instalación, clave de dispositivo, activación y licencia; debe permanecer compatible con `UC-DEV-001`, `UC-LIC-001`, `UC-LIC-002`, `DEC-007` y `DEC-008`.
## Ciclo operativo de inventario

RN-118. `InventoryMovement` constituye la fuente de verdad de los cambios de existencia; `StockBalance` es una proyección derivada y no debe sustituir el historial de movimientos.

RN-119. Una operación confirmada que afecte inventario debe generar movimientos explícitos y actualizar la proyección de saldo de forma atómica respecto de dichos movimientos.

RN-120. Las reservas reducen disponibilidad, pero no existencia física; consumir una reserva debe generar los movimientos correspondientes y liberarla no debe generar una entrada ficticia de inventario.

RN-121. La creación y las transiciones sensibles de reservas, movimientos, ajustes y traslados deben ser idempotentes cuando exista posibilidad de reintento; una misma `idempotency_key` no puede producir efectos de inventario duplicados.

RN-122. Las operaciones sensibles de inventario deben soportar control de concurrencia mediante versión esperada o mecanismo equivalente y deben rechazar actualizaciones basadas en estado obsoleto cuando no puedan resolverse de forma segura.

RN-123. Ninguna reserva, movimiento, ajuste, merma, traslado, lote, saldo o conflicto de inventario puede cruzar límites de tenant; empresa, sucursal y ubicación deben respetar el alcance autorizado de la operación.

RN-124. Los traslados deben conservar una identidad operacional propia y generar movimientos explícitos de salida y entrada; no deben modificar directamente `StockBalance` ni eliminar movimientos previos para representar cancelaciones o correcciones.

RN-125. Una recepción parcial, diferencia, pérdida o inconsistencia durante un traslado debe conservarse explícitamente y resolverse mediante incidencia, ajuste, merma, compensación u otro proceso autorizado, nunca mediante sobrescritura silenciosa del historial.

RN-126. Los ajustes manuales y las mermas deben conservar motivo, actor, referencia, cantidades y trazabilidad; las correcciones posteriores deben realizarse mediante nuevos movimientos o compensaciones explícitas.

RN-127. La selección de lotes debe aplicar FEFO cuando exista vencimiento y la política lo requiera; cuando no exista vencimiento puede aplicarse FIFO u otra política configurada y autorizada.

RN-128. Las operaciones local-first u offline deben conservar tenant, ubicación, identidad de producto, `idempotency_key` y evidencia suficiente para reconciliación; la operación offline no puede utilizarse para evadir aislamiento, autorización ni reglas de consistencia.

RN-129. Un conflicto de inventario que no pueda resolverse automáticamente de forma segura debe producir revisión o compensación explícita, incluyendo estados conceptuales como `REVIEW_REQUIRED` o `COMPENSATION_REQUIRED`; no debe corregirse mediante edición destructiva del historial.

RN-130. `UC-INVENTORY-002` define el ciclo operativo de reservas, salidas, ajustes, mermas, traslados, lotes, vencimientos, concurrencia y conflictos de inventario y debe permanecer compatible con `UC-INVENTORY-001`, las políticas de autorización y el modelo conceptual de inventario.
## Identidad, pertenencia y autorización multi-tenant

RN-131. `User` representa una identidad autenticable global y no utiliza `tenant_id` como autoridad de pertenencia.

RN-132. La pertenencia de un usuario a un tenant se representa exclusivamente mediante una `TenantMembership` explícita y válida.

RN-133. La autenticación exitosa de un usuario no concede por sí sola acceso a ningún tenant; el acceso requiere una pertenencia válida y la autorización efectiva correspondiente.

RN-134. Una `TenantMembership` con `membership_type = OWNER` identifica al propietario administrativo del tenant, pero no concede por sí sola todos los permisos ni elimina controles RBAC, ABAC, MFA o reautenticación.

RN-135. `UserRoleAssignment` define roles y alcance operativo dentro de una `TenantMembership`; no determina pertenencia al tenant ni puede utilizarse para conceder acceso cruzado entre tenants.

RN-136. Toda asignación con alcance de empresa o sucursal debe permanecer dentro del mismo tenant de la `TenantMembership` correspondiente.

RN-137. Revocar una `TenantMembership` o una `UserRoleAssignment` no elimina la identidad global del usuario ni los datos históricos del tenant.

RN-138. `UC-ONB-001` debe crear o resolver una identidad `User`, establecer una `TenantMembership` explícita para el propietario inicial y aplicar roles y permisos mediante asignaciones separadas conforme a `SEC-002`.

RN-139. La resolución del tenant efectivo debe derivarse de contexto autenticado y relaciones autorizadas; nunca debe confiarse en un `tenant_id` libre suministrado por el cliente como prueba suficiente de pertenencia.

## Arqueos de caja

RN-140. ExpectedCash se deriva exclusivamente de CashMovement `POSTED`; un arqueo o diferencia no crea ajustes automáticos.

RN-141. Un CashCount completado no se edita: una corrección crea otro CashCount relacionado y conserva el original.

RN-142. Toda diferencia distinta de cero genera revisión; una diferencia material requiere autorización y no puede ser aprobada por el mismo actor que contó cuando la política exige segregación.

## Devoluciones comerciales

RN-143. `SaleReturn` pertenece a Sales, referencia una `Sale` `COMPLETED` y conserva el mismo tenant, empresa, sucursal y moneda; un identificador enviado por el cliente no constituye autorización ni permite acceso cross-tenant.

RN-144. Una devolución no elimina ni reescribe Sale o SaleItem; conserva snapshots originales de cantidades, precios, descuentos, impuestos y políticas, y cambios posteriores no alteran su valor histórico.

RN-145. La cantidad y el importe acumulados devueltos por SaleItem no pueden superar lo vendido y todavía elegible; una devolución parcial solo afecta sus líneas y no convierte automáticamente toda la venta en devuelta.

RN-146. `RETURN_EXECUTION_IN_PROGRESS`, `RETURN_PARTIALLY_COMPLETED` y `RETURN_COMPLETED` son estados persistentes de SaleReturn; `PARTIALLY_RETURNED` y `FULLY_RETURNED` son proyecciones derivadas de Sale.

RN-147. SaleReturn, Refund y Reversal son agregados diferentes: Sales es propietario de SaleReturn y Payments de Refund/Reversal; una devolución comercial no confirma automáticamente un reembolso, reversión, salida de caja, restitución de inventario o corrección fiscal.

RN-148. Toda devolución crítica conserva UUID global, `operation_id`, `idempotency_key`, checksum, versión esperada, causalidad y auditoría; un reintento o replay no duplica la devolución ni sus efectos.

RN-149. Dos devoluciones concurrentes sobre la misma elegibilidad se validan centralmente y producen aceptación compatible, rechazo o `REVIEW_REQUIRED`; nunca se resuelven mediante último timestamp.

RN-150. Una restitución de producto requiere condición física y un InventoryMovement explícito; no se modifica StockBalance ni el historial, y una corrección genera movimiento compensatorio.

RN-151. Un Refund en efectivo requiere un CashMovement separado y política de turno válida; los medios externos conservan resultado pendiente o incierto hasta evidencia autoritativa y no se simula una capacidad de reversal inexistente.

RN-152. La consecuencia fiscal de SaleReturn pertenece a Electronic Invoicing y crea, cuando corresponda, un documento correctivo relacionado; no modifica el documento original ni acopla Sales directamente a DIAN o a un proveedor.

RN-153. Solicitar, aprobar, ejecutar, revisar y leer SaleReturn usan permisos `sales.return.*`; Refund usa `payments.refund.*` y Reversal `payments.reversal.*`. La política puede exigir reautenticación, MFA, aprobación superior y segregación entre actores.

RN-154. `PAY-007` es la única autoridad de `ReconciliationStatus`: `CREATED`, `RUNNING`, `REVIEW_REQUIRED`, `PARTIALLY_RECONCILED`, `RECONCILED`, `FAILED`, `CANCELLED`, `CLOSED` y `REOPENED`. `OPEN` y `PROCESSING` no son estados de Reconciliation; periodo y alcance son snapshots sin máquina de estados propia.

RN-155. Reversal, Settlement y Reconciliation pertenecen a Payments y nunca modifican Payment histórico, Sale, CashMovement, InventoryMovement ni documento fiscal para cuadrar un resultado. Cada efecto de otro dominio se registra por su propietario.

RN-156. Settlement conserva por separado bruto, comisiones, retenciones, refunds, reversals, contracargos, ajustes positivos, ajustes negativos y neto, usando dinero exacto. Cada cálculo congela política/version, entradas, evidencia, resultado y si el bruto incluye operaciones posteriormente reversadas o ya viene neto; un reversal nunca se descuenta dos veces.

RN-157. El resultado externo de Reversal y la evidencia de Settlement respetan provider authority. Webhooks, callbacks, archivos y reintentos se autentican, deduplican y procesan idempotentemente; incertidumbre o contradicción genera consulta o revisión, no éxito implícito ni last-write-wins.

RN-158. Toda relación financiera es tenant-scoped. Una identidad, referencia externa, idempotency key, configuración o evidencia de otro tenant se rechaza sin revelar su existencia.

RN-159. Cerrar o reabrir Reconciliation, aceptar o resolver diferencias y configurar proveedor exige permiso atómico, motivo y auditoría append-only; la política puede requerir reautenticación, MFA y segregación de funciones usando únicamente roles existentes.

RN-160. Los eventos canónicos de Reversal y Reconciliation usan los nombres definidos por `PAY-007`; no se mantienen aliases para el mismo hecho. Items e incidencias pueden emitir hechos distintos sin redefinir el estado del agregado.

## Configuraciones versionadas por dominio

RN-161. No existe un agregado global `Configuration`: Pricing, Tax, Authorization, Payments, Electronic Invoicing, Cash Register, Inventory, Licensing y Devices son autoridad de sus configuraciones nativas; Sync solo distribuye referencias, versiones y snapshots verificables.

RN-162. Toda versión publicada es inmutable. Corregir, retirar o restaurar comportamiento crea una versión nueva o una revocación explícita y conserva actor, motivo, vigencia, checksum y relación de sustitución.

RN-163. `DRAFT`, `PUBLISHED`, `SUPERSEDED` y `REVOKED` son estados persistentes de versiones administrables. `SCHEDULED`, `CURRENT` y `EXPIRED` son proyecciones de vigencia; los estados locales de `UC-SYNC-002` no cambian el lifecycle central.

RN-164. Toda configuración multi-tenant conserva o deriva inequívocamente `tenant_id`; sus Company, Branch, dispositivo, instalación, cuenta, ambiente y demás scopes deben pertenecer al mismo tenant. El cliente nunca constituye autoridad del scope.

RN-165. No existe precedencia automática Branch/Company/Tenant/Platform. Toda selección declara scope, prioridad, elegibilidad, vigencia, versión de política, composición y desempate; una ambigüedad sin regla normativa se rechaza y jamás se resuelve por timestamp, orden de llegada o last-write-wins.

RN-166. La vigencia usa `[valid_from, valid_until)`. Un hueco no activa defaults, versiones vencidas o revocadas; produce la denegación, degradación segura o revisión explícita definida por el dominio.

RN-167. El checksum canónico incluye identidad, versión, esquema, tenant/scopes, vigencia, criterios y payload material determinista, pero excluye datos de transporte, metadatos no materiales y secretos. El checksum no sustituye firma ni autenticidad.

RN-168. Toda operación histórica conserva referencias de versión, checksum, entradas y resultado suficientes para replay. Ventas separan snapshots de pricing, Tax y redondeo; Electronic Invoicing separa snapshot tributario de operación y snapshot de emisión fiscal.

RN-169. Cash Register es propietario de `CashPolicy`/`CashPolicyVersion` e Inventory de `InventoryPolicy`/`InventoryPolicyVersion`. Esas políticas no absorben ciclos operativos ni admiten JSON libre; solo representan reglas normativamente autorizadas.

RN-170. Una réplica local se aplica atómicamente después de validar tenant, firma, checksum, esquema, secuencia, vigencia y dependencias. Una copia parcial, inválida o revocada no amplía permiso, licencia, capacidad de proveedor ni confianza del dispositivo.

RN-171. Los secretos utilizables nunca se almacenan en configuraciones, snapshots, eventos, auditoría o checksum. Solo se conservan referencias opacas al almacén aprobado y los cambios sensibles exigen controles reforzados.

RN-172. Crear draft, leer, publicar, programar, revocar y sustituir son acciones autorizables separadamente por dominio. No existe un permiso universal de configuración ni un rollback que mute historia.

## Dead letter de sincronización

RN-173. `SyncDeadLetter` es un agregado separado propiedad de Sync que referencia una única `SyncOperation`; no reemplaza Operation, Outbox o Inbox, no contiene otra intención y no copia el payload.

RN-174. `SyncOperation` conserva la identidad, idempotency key, payload y checksum inmutables. Todo retry reutiliza operation, Outbox y causalidad; cambiar intención o payload exige una operación nueva causalmente relacionada.

RN-175. Existe como máximo una dead letter por operation. Un reingreso por nuevo agotamiento añade evidencia append-only y no crea otra operación ni dead letter paralela.

RN-176. Outbox es autoridad de scheduling e intentos locales; Inbox es autoridad de deduplicación y resultado central; DeadLetter es autoridad de clasificación, revisión, reactivación y archivo del caso.

RN-177. DeadLetter reutiliza `DEAD_LETTER`, `REVIEW_REQUIRED`, `RETRY_SCHEDULED` y `ARCHIVED`; `SERVER_ACCEPTED`/`SERVER_REJECTED` pertenecen a Operation/Inbox y no se duplican en el agregado de tratamiento.

RN-178. El límite, backoff, jitter, ventana, exclusiones y agotamiento provienen de una política técnica versionada. Errores permanentes o de seguridad detienen retry automático.

RN-179. Firma/checksum inválidos, tenant violation, dispositivo revocado, autorización denegada y payload inválido conservan evidencia y producen revisión/rechazo y señal de seguridad; repetir no corrige ni amplía autoridad.

RN-180. Revisar, reintentar, rechazar y archivar exigen permiso atómico, tenant/scope válido, actor, motivo, auditoría y expected version. La política puede exigir MFA, reautenticación y segregación.

RN-181. Si B depende de A y A está en dead letter, B permanece bloqueada, pendiente o en revisión según política; no se aplica por orden de llegada. Resolver A reevalúa B sin perder causalidad.

RN-182. `ARCHIVED` no significa borrado. Operación, Outbox, Inbox, DeadLetter, acciones y auditoría se conservan conforme a retención; cualquier purga futura es separada, autorizada y auditable.

RN-183. Una respuesta perdida después de aplicación central se resuelve por Inbox e idempotencia antes de dead-lettering; el mismo operation/checksum devuelve el resultado previo y no duplica efecto.

RN-184. Tenant de DeadLetter, Operation, Outbox, Inbox, Conflict, Review y acciones debe coincidir. El tenant enviado por cliente no es autoridad y nunca se reasigna una operación entre tenants.

RN-185. Si nodos local y central detectan el mismo caso concurrentemente, convergen a una sola SyncDeadLetter por operation y conservan acciones idempotentes; no eligen identidad o resultado por timestamp.

## Agregados fiscales neutrales

RN-186. `ElectronicDocument` es el único agregado canónico del documento de Electronic Invoicing. `FiscalDocument` no existe como entidad paralela y CUFE, CUDE, prefijo, número o referencia externa nunca sustituyen su identidad interna global.

RN-187. Tax es autoridad de reglas, clasificación, tarifas, vigencia, cálculo y resultado tributario. Electronic Invoicing consume un snapshot tributario inmutable y conserva separadamente el snapshot de configuración/emisión; nunca recalcula Tax.

RN-188. `ElectronicDocument`, `FiscalSubmissionAttempt`, `FiscalIncident`, `FiscalReconciliation` y el estado original del proveedor tienen máquinas independientes. Un estado técnico no prueba aceptación o rechazo fiscal.

RN-189. `FiscalSubmissionAttempt` usa `CREATED`, `IN_PROGRESS`, `COMPLETED`, `FAILED`, `UNKNOWN_OUTCOME` y `CANCELLED`. `transport_status` y `normalized_result` son dimensiones separadas; un attempt `COMPLETED` puede normalizar aceptación o rechazo sin adoptar esos estados.

RN-190. `FiscalIncident` usa exclusivamente `OPEN`, `IN_REVIEW`, `RESOLVED` y `ARCHIVED`. Clasificación y resolución son atributos; archivar no borra evidencia.

RN-191. `FiscalReconciliation` de Electronic Invoicing usa `CREATED`, `RUNNING`, `REVIEW_REQUIRED`, `PARTIALLY_RECONCILED`, `RECONCILED`, `FAILED`, `CANCELLED`, `CLOSED` y `REOPENED`. Su alcance es snapshot y no comparte entidad ni enum física con Payments.

RN-192. Si una respuesta se pierde después de transmitir, attempt y documento pueden conservar `UNKNOWN_OUTCOME` en dimensiones diferentes. Consulta, polling, webhook validado o reconciliación pueden resolver el documento, pero nunca reescriben el attempt histórico para ocultar la incertidumbre.

RN-193. La misma intención fiscal conserva documento, source, payload congelado, checksum e idempotencia. Un retry técnico crea otro attempt y no otro documento ni otra numeración sin decisión explícita y evidencia segura.

RN-194. Todo recurso fiscal es tenant-scoped. Source, conexión, documento, attempt, artefacto, incidente, conciliación, secreto referenciado y actor deben pertenecer al mismo tenant; una identidad externa o `tenant_id` del cliente no concede autoridad.

RN-195. Una corrección fiscal crea otro `ElectronicDocument` relacionado y no modifica el original. SaleReturn solo origina evaluación; Sales, Refund o Reversal no deciden el tipo fiscal ni demuestran por sí solos que el correctivo corresponde.

RN-196. El POS local puede persistir intención, snapshots y outbox según modalidad, pero no es autoridad final de aceptación externa. Reconexión, retry, webhook o polling no pueden duplicar una emisión.

RN-197. Credenciales, tokens, API keys, claves privadas y certificados privados no se almacenan en agregados, artefactos, eventos, logs o auditoría. Solo se conservan referencias opacas tenant-scoped y evidencia no secreta autorizada.

RN-198. Webhooks requieren autenticidad, deduplicación, replay protection, evidencia cruda referenciada y procesamiento mediante caso de uso. Una firma inválida se rechaza y puede abrir incidente fiscal y evento de seguridad.

RN-199. Auditoría fiscal es append-only. Resolver incidencia, forzar reconciliación, cerrar/reabrir, cambiar conexión, numeración, proveedor o referencia secreta exige permiso atómico, motivo y controles reforzados según riesgo.

## Remediación física transversal R1

RN-200. `AuditEvent` es append-only, usa schema versionado, correlación y causalidad cuando corresponda, y solo conserva snapshots before/after limitados y sanitizados; los roles operacionales no lo actualizan ni eliminan.

RN-201. Un evento de auditoría no contiene secretos, tokens, passwords, PAN, CVV, claves privadas, certificados utilizables, blobs completos de proveedor ni payload fiscal innecesario. Reviewer/approver son obligatorios cuando la política exige revisión, aprobación o segregación.

RN-202. `SyncOperation` conserva intención, payload, checksum, identidad e idempotencia; existe como máximo una `OutboxEntry` autoritativa por `operation_id`. Retry y ACK perdido reutilizan ambas identidades; Outbox controla entrega, Inbox deduplica/retorna resultado, DeadLetter trata agotamiento y el dominio resuelve conflictos.

RN-203. `DeviceKey.id` es su única identidad UUID v7 y representa `device_key_id`; fingerprint, versión, clave central firmante y clave de reemplazo son conceptos separados y no crean otra identidad del agregado.

RN-204. Los límites persistentes usan exclusivamente `FINITE`, `UNLIMITED` o `NOT_APPLICABLE`. `FINITE` exige valor exacto no negativo y cero es cupo cero; los otros tipos exigen valor ausente. Una dimensión requerida no configurada impide emisión y falla cerrada, sin sentinels ni magic numbers.

RN-205. Importes de cálculo y financieros usan escala 6, tasas/factores escala 10 y un importe usa escala 2 solo después de normalización fiscal/contable explícita y versionada. PostgreSQL/SQLite conservan equivalencia exacta y ningún adaptador usa coma flotante autoritativa.

RN-206. `PriceChange` no es entidad física: historial de precio se conserva mediante versiones inmutables, vigencia, eventos, auditoría y snapshot de Sale. Un workflow futuro de solicitud/aprobación requiere caso de uso y agregado propios.

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

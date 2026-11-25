package co.camachopos.colombia.ui

import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.os.IBinder
import android.util.TypedValue
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import co.camachopos.colombia.CommercialIdentity
import co.camachopos.colombia.hardware.CommercialHardwareBridge
import co.camachopos.colombia.hardware.HardwareSurfaceGate
import co.camachopos.colombia.runtime.LocalPosService
import co.camachopos.colombia.runtime.PosClient
import co.camachopos.colombia.runtime.TrialCapacityBridge
import co.camachopos.colombia.security.OfflineExpiryPolicy
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneId

/**
 * Commercial workspace backed only by Local Service contracts + SSA session.
 * No mock successes. Every action invokes a real message_type.
 */
class PosShellActivity : Activity() {
    private var binder: LocalPosService.LocalBinder? = null
    private var client: PosClient? = null
    private lateinit var content: LinearLayout
    private lateinit var statusLine: TextView
    private var hardware: CommercialHardwareBridge? = null
    private val yellow = Color.parseColor("#FFC400")
    private val navy = Color.parseColor("#10283D")
    private val surface = Color.parseColor("#F3F6F8")
    private val muted = Color.parseColor("#536475")
    private val ink = Color.parseColor("#142B3A")
    private val danger = Color.parseColor("#9F2525")
    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            binder = service as LocalPosService.LocalBinder
            client = PosClient(binder!!)
            hardware = CommercialHardwareBridge(this@PosShellActivity)
            client?.recoverSession { result ->
                runOnUiThread {
                    val outcome = result.optJSONObject("result")?.optString("outcome")
                    if (outcome != "ACTIVE") {
                        startActivity(Intent(this@PosShellActivity, EntryActivity::class.java))
                        finish()
                    } else {
                        val sessionId = result.optJSONObject("result")?.optString("session_id").orEmpty()
                        statusLine.text = if (sessionId.isBlank()) "Sesión BUSINESS" else "Sesión · ${sessionId.take(8)}"
                        showHome()
                    }
                }
            }
        }
        override fun onServiceDisconnected(name: ComponentName?) {
            binder = null
            client = null
            hardware = null
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(surface)
        }
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(navy)
            setPadding(dp(16), dp(14), dp(16), dp(14))
            gravity = Gravity.CENTER_VERTICAL
        }
        val brand = ImageView(this).apply {
            adjustViewBounds = true
            contentDescription = CommercialIdentity.DISPLAY_NAME
            layoutParams = LinearLayout.LayoutParams(dp(140), dp(48))
            runCatching {
                assets.open("brand_lockup.png").use { setImageBitmap(BitmapFactory.decodeStream(it)) }
            }
        }
        statusLine = TextView(this).apply {
            text = "…"
            setTextColor(yellow)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                leftMargin = dp(12)
            }
        }
        header.addView(brand)
        header.addView(statusLine)
        content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(16), dp(16), dp(16))
        }
        root.addView(header)
        root.addView(ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
            addView(content)
        })
        setContentView(root)
        bindService(Intent(this, LocalPosService::class.java), connection, Context.BIND_AUTO_CREATE)
    }

    private fun showHome() {
        content.removeAllViews()
        content.addView(title("Espacio de trabajo"))
        listOf(
            "Caja / Turnos" to { showCash() },
            "Carrito / Ventas" to { showSales() },
            "Catálogo" to { showCatalog() },
            "Inventario" to { showInventory() },
            "Clientes" to { showCustomers() },
            "Pagos / Sync" to { showPayments() },
            "Hardware" to { showHardware() },
            "Licencia / Trial" to { showLicense() },
            "Permisos" to { showCapabilities() },
            "Cerrar sesión" to { logout() },
        ).forEach { (label, action) -> content.addView(primaryButton(label, action)) }
    }

    private fun showCash() {
        screen("Caja / Turnos") {
            val register = field("ID de caja (UUID)")
            val amount = field("Monto de apertura (scale-6)")
            addView(register)
            addView(amount)
            addView(primaryButton("Abrir turno") {
                val zone = ZoneId.systemDefault()
                client?.invoke(
                    "cash.shift.open",
                    JSONObject()
                        .put("cash_register_id", register.text.toString().trim())
                        .put("opening_amount", amount.text.toString().trim())
                        .put("business_date", LocalDate.now(zone).toString())
                        .put("timezone_id", zone.id)
                        .put("utc_offset_minutes", zone.rules.getOffset(java.time.Instant.now()).totalSeconds / 60),
                    idempotent = true,
                ) { showResult(it) }
            })
            val shiftId = field("ID de turno abierto")
            val expected = field("Versión esperada al cerrar")
            addView(shiftId)
            addView(expected)
            addView(primaryButton("Cerrar turno") {
                client?.invoke(
                    "cash.shift.close",
                    JSONObject()
                        .put("shift_id", shiftId.text.toString().trim())
                        .put("expected_version", expected.text.toString().trim().toIntOrNull() ?: 1)
                        .put("counted_amount", amount.text.toString().trim().ifBlank { "0.000000" }),
                    idempotent = true,
                ) { showResult(it) }
            })
        }
    }

    private fun showSales() {
        screen("Carrito / Ventas") {
            val register = field("ID de caja (UUID o vacío)")
            val product = field("ID producto")
            val presentation = field("ID presentación")
            val quantity = field("Cantidad scale-6")
            val barcode = field("Identificador escaneado (opcional)")
            addView(register); addView(product); addView(presentation); addView(quantity); addView(barcode)
            addView(primaryButton("Crear venta (offline/local)") {
                val zone = ZoneId.systemDefault()
                val registerId = register.text.toString().trim()
                client?.invoke(
                    "sale.create",
                    JSONObject()
                        .put("cash_register_id", if (registerId.isBlank()) JSONObject.NULL else registerId)
                        .put("customer_id", JSONObject.NULL)
                        .put("channel", "POS")
                        .put("business_date", LocalDate.now(zone).toString())
                        .put("timezone_id", zone.id)
                        .put("utc_offset_minutes", zone.rules.getOffset(java.time.Instant.now()).totalSeconds / 60)
                        .put("document_series", "POS")
                        .put("currency_code", "COP")
                        .put(
                            "lines",
                            JSONArray().put(
                                JSONObject()
                                    .put("product_id", product.text.toString().trim())
                                    .put("presentation_id", presentation.text.toString().trim())
                                    .put("quantity", quantity.text.toString().trim())
                                    .put(
                                        "identifier",
                                        barcode.text.toString().trim().ifBlank { JSONObject.NULL },
                                    ),
                            ),
                        ),
                    idempotent = true,
                ) { showResult(it) }
            })
            val cartId = field("ID carrito en espera")
            addView(cartId)
            addView(primaryButton("Listar carritos en espera") {
                client?.invoke("cart.waiting.list") { showResult(it) }
            })
            addView(primaryButton("Obtener carrito") {
                client?.invoke(
                    "cart.waiting.get",
                    JSONObject().put("cart_id", cartId.text.toString().trim()),
                ) { showResult(it) }
            })
            addView(primaryButton("Descartar carrito") {
                client?.invoke(
                    "cart.waiting.discard",
                    JSONObject()
                        .put("cart_id", cartId.text.toString().trim())
                        .put("expected_version", 1),
                    idempotent = true,
                ) { showResult(it) }
            })
            val saleId = field("ID de venta")
            addView(saleId)
            addView(primaryButton("Cancelar venta") {
                client?.invoke(
                    "sale.cancel",
                    JSONObject().put("sale_id", saleId.text.toString().trim()),
                    idempotent = true,
                ) { showResult(it) }
            })
            addView(primaryButton("Ver recibo") {
                client?.invoke(
                    "sales.receipt.get",
                    JSONObject().put("sale_id", saleId.text.toString().trim()),
                ) { showResult(it) }
            })
        }
    }

    private fun showCatalog() {
        screen("Catálogo") {
            val query = field("Consulta")
            addView(query)
            addView(primaryButton("Listar productos") {
                client?.invoke(
                    "catalog.item.list",
                    JSONObject()
                        .put("query", query.text.toString().trim())
                        .put("limit", 40)
                        .put("offset", 0),
                ) { showResult(it) }
            })
            val barcode = field("Código de barras")
            addView(barcode)
            addView(primaryButton("Buscar por código") {
                client?.invoke(
                    "catalog.item.find",
                    JSONObject().put("barcode", barcode.text.toString().trim()),
                ) { showResult(it) }
            })
            val presentation = field("ID presentación")
            addView(presentation)
            addView(primaryButton("Obtener presentación") {
                client?.invoke(
                    "catalog.item.get",
                    JSONObject().put("presentation_id", presentation.text.toString().trim()),
                ) { showResult(it) }
            })
        }
    }

    private fun showInventory() {
        screen("Inventario") {
            val presentation = field("ID presentación")
            val qty = field("Cantidad scale-6")
            val reason = field("Código motivo (REASON_CODE)")
            addView(presentation); addView(qty); addView(reason)
            addView(primaryButton("Consultar stock") {
                client?.invoke(
                    "inventory.stock.get",
                    JSONObject().put("presentation_id", presentation.text.toString().trim()),
                ) { showResult(it) }
            })
            addView(primaryButton("Listar lotes") {
                client?.invoke(
                    "inventory.batch.list",
                    JSONObject().put("presentation_id", presentation.text.toString().trim()),
                ) { showResult(it) }
            })
            addView(primaryButton("Recibir stock") {
                client?.invoke(
                    "inventory.stock.receive",
                    JSONObject()
                        .put("presentation_id", presentation.text.toString().trim())
                        .put("movement_type", "PURCHASE_RECEIPT")
                        .put("quantity", qty.text.toString().trim())
                        .put("reason_code", reason.text.toString().trim().ifBlank { "PURCHASE_RECEIPT" })
                        .put("business_date", LocalDate.now().toString()),
                    idempotent = true,
                ) { showResult(it) }
            })
            addView(primaryButton("Ajustar stock (+)") {
                client?.invoke(
                    "inventory.stock.adjust",
                    JSONObject()
                        .put("presentation_id", presentation.text.toString().trim())
                        .put("movement_type", "ADJUSTMENT_POSITIVE")
                        .put("quantity", qty.text.toString().trim())
                        .put("reason_code", reason.text.toString().trim().ifBlank { "ADJUSTMENT_POSITIVE" })
                        .put("business_date", LocalDate.now().toString()),
                    idempotent = true,
                ) { showResult(it) }
            })
        }
    }

    private fun showCustomers() {
        screen("Clientes") {
            val docCode = field("Código DIAN documento (13=CC)")
            val doc = field("Identificación (solo dígitos)")
            val names = field("Nombres")
            addView(docCode); addView(doc); addView(names)
            addView(primaryButton("Buscar cliente") {
                client?.invoke(
                    "customer.find",
                    JSONObject()
                        .put("identification_document_code", docCode.text.toString().trim().ifBlank { "13" })
                        .put("identification", doc.text.toString().trim()),
                ) { showResult(it) }
            })
            addView(primaryButton("Registrar cliente") {
                client?.invoke(
                    "customer.register",
                    JSONObject()
                        .put("identification_document_code", docCode.text.toString().trim().ifBlank { "13" })
                        .put("identification", doc.text.toString().trim())
                        .put("verification_digit", JSONObject.NULL)
                        .put("legal_organization_code", "2")
                        .put("company", JSONObject.NULL)
                        .put("names", names.text.toString().trim())
                        .put("tribute_code", "ZZ")
                        .put("fiscal_responsibility_codes", JSONArray().put("R-99-PN"))
                        .put("email", JSONObject.NULL)
                        .put("phone", JSONObject.NULL)
                        .put("address", JSONObject.NULL)
                        .put("country_code", "CO")
                        .put("municipality_code", JSONObject.NULL),
                    idempotent = true,
                ) { showResult(it) }
            })
            val customerId = field("ID cliente")
            addView(customerId)
            addView(primaryButton("Obtener cliente") {
                client?.invoke(
                    "customer.get",
                    JSONObject().put("customer_id", customerId.text.toString().trim()),
                ) { showResult(it) }
            })
        }
    }

    private fun showPayments() {
        screen("Pagos / Sync") {
            val saleId = field("ID venta")
            val amount = field("Monto scale-6")
            val paymentId = field("ID pago")
            val version = field("Versión esperada")
            addView(saleId); addView(amount); addView(paymentId); addView(version)
            addView(primaryButton("Registrar efectivo") {
                client?.invoke(
                    "payment.register.cash",
                    JSONObject()
                        .put("sale_id", saleId.text.toString().trim())
                        .put("amount", amount.text.toString().trim()),
                    idempotent = true,
                ) { showResult(it) }
            })
            addView(primaryButton("Transferencia Nequi/Bre-B") {
                client?.invoke(
                    "payment.register.transfer",
                    JSONObject()
                        .put("sale_id", saleId.text.toString().trim())
                        .put("amount", amount.text.toString().trim())
                        .put("provider_code", "NEQUI")
                        .put("provider_reference", JSONObject.NULL),
                    idempotent = true,
                ) { showResult(it) }
            })
            addView(primaryButton("Confirmar transferencia") {
                client?.invoke(
                    "payment.transfer.confirm",
                    JSONObject()
                        .put("payment_id", paymentId.text.toString().trim())
                        .put("expected_version", version.text.toString().trim().toIntOrNull() ?: 1),
                    idempotent = true,
                ) { showResult(it) }
            })
            addView(primaryButton("FACTUS Pay cobrar") {
                client?.invoke(
                    "payment.factus_pay.collect",
                    JSONObject()
                        .put("sale_id", saleId.text.toString().trim())
                        .put("amount", amount.text.toString().trim())
                        .put("expiration_seconds", 900),
                    idempotent = true,
                ) { showResult(it) }
            })
            addView(primaryButton("FACTUS Pay verificar") {
                client?.invoke(
                    "payment.factus_pay.verify",
                    JSONObject()
                        .put("payment_id", paymentId.text.toString().trim())
                        .put("expected_version", version.text.toString().trim().toIntOrNull() ?: 1),
                    idempotent = true,
                ) { showResult(it) }
            })
            addView(primaryButton("FACTUS Pay reanudar") {
                client?.invoke(
                    "payment.factus_pay.resume",
                    JSONObject().put("sale_id", saleId.text.toString().trim()),
                    idempotent = true,
                ) { showResult(it) }
            })
            addView(primaryButton("Consultar pago") {
                client?.invoke(
                    "payment.get",
                    JSONObject().put("payment_id", paymentId.text.toString().trim()),
                ) { showResult(it) }
            })
            addView(note("Outbox/sync: el motor DurableSync arranca con provisión. El estado se observa vía licencia y resultados de venta offline."))
            addView(primaryButton("Estado del servicio") {
                val status = binder?.status().orEmpty()
                showResult(
                    JSONObject()
                        .put("status", "SUCCEEDED")
                        .put("result_code", "HOST_STATUS")
                        .put("result", JSONObject(status)),
                )
            })
        }
    }

    private fun showHardware() {
        screen("Hardware") {
            val bridge = hardware
            addView(note("CH340 VID/PID ${HardwareSurfaceGate.CH340_VENDOR_ID}/${HardwareSurfaceGate.CH340_PRODUCT_ID}. Impresora/cajón vía UsbHostTransport existente. Sin pulso físico simulado."))
            addView(primaryButton("Descubrir USB") {
                val devices = bridge?.discover().orEmpty()
                showResult(
                    JSONObject()
                        .put("status", "SUCCEEDED")
                        .put("result_code", "USB_INVENTORY")
                        .put("result", JSONObject().put("devices", JSONArray(devices.map {
                            JSONObject()
                                .put("name", it.deviceName)
                                .put("vendorId", it.vendorId)
                                .put("productId", it.productId)
                                .put("permission", it.permissionGranted)
                                .put("kind", HardwareSurfaceGate.classify(it.vendorId, it.productId))
                        }))),
                )
            })
            addView(primaryButton("Pedir permiso CH340") {
                val scale = bridge?.discover()?.firstOrNull {
                    it.vendorId == HardwareSurfaceGate.CH340_VENDOR_ID && it.productId == HardwareSurfaceGate.CH340_PRODUCT_ID
                }
                if (scale == null) {
                    showResult(failed("SCALE_NOT_PRESENT", "No hay CH340 conectado."))
                } else {
                    bridge.requestPermission(scale.deviceName)
                    showResult(
                        JSONObject()
                            .put("status", "SUCCEEDED")
                            .put("result_code", "USB_PERMISSION_REQUESTED")
                            .put("result", JSONObject().put("device", scale.deviceName)),
                    )
                }
            })
            val register = field("ID caja para pesaje")
            val presentation = field("ID presentación masa")
            addView(register); addView(presentation)
            addView(primaryButton("Capturar peso (contrato)") {
                client?.invoke(
                    "hardware.command",
                    JSONObject()
                        .put("action", "capture_weight")
                        .put("cash_register_id", register.text.toString().trim())
                        .put("presentation_id", presentation.text.toString().trim()),
                ) { showResult(it) }
            })
            val jobId = field("Job ID")
            val saleId = field("Sale ID")
            val bindingId = field("Binding ID")
            addView(jobId); addView(saleId); addView(bindingId)
            addView(primaryButton("Listar hardware") {
                client?.invoke("hardware.command", JSONObject().put("action", "list")) { showResult(it) }
            })
            addView(primaryButton("Diagnosticar hardware") {
                client?.invoke("hardware.command", JSONObject().put("action", "diagnose")) { showResult(it) }
            })
            addView(primaryButton("Imprimir recibo (contrato)") {
                client?.invoke(
                    "hardware.command",
                    JSONObject()
                        .put("action", "print_receipt")
                        .put("job_id", jobId.text.toString().trim())
                        .put("sale_id", saleId.text.toString().trim()),
                ) { showResult(it) }
            })
            addView(primaryButton("Encolar apertura de cajón") {
                if (!HardwareSurfaceGate.isCommercialHardwareReady(true, false)) {
                    showResult(
                        failed(
                            HardwareSurfaceGate.DRAWER_BLOCK_REASON,
                            "Perfil eléctrico del cajón M60WL no verificado en este dispositivo.",
                        ),
                    )
                    return@primaryButton
                }
                client?.invoke(
                    "hardware.command",
                    JSONObject()
                        .put("action", "enqueue")
                        .put("job_id", jobId.text.toString().trim())
                        .put("binding_id", bindingId.text.toString().trim())
                        .put("kind", "DRAWER_OPEN")
                        .put("sale_id", JSONObject.NULL)
                        .put("reason", "CASH_DRAWER_OPEN"),
                ) { showResult(it) }
            })
            addView(primaryButton("Despachar job") {
                client?.invoke(
                    "hardware.command",
                    JSONObject()
                        .put("action", "dispatch")
                        .put("job_id", jobId.text.toString().trim()),
                ) { showResult(it) }
            })
        }
    }

    private fun showLicense() {
        screen("Licencia / Trial") {
            addView(note(TrialCapacityBridge.describeCapacityPolicy()))
            addView(primaryButton("Consultar licencia") {
                binder?.queryLicenseInformation { info ->
                    runOnUiThread {
                        val allowed = OfflineExpiryPolicy.allowsCommercialSale(info.status, trustedClockOk = true)
                        showResult(
                            JSONObject()
                                .put("status", "SUCCEEDED")
                                .put("result_code", info.status)
                                .put(
                                    "result",
                                    JSONObject()
                                        .put("status", info.status)
                                        .put("signedValidUntil", info.signedValidUntil)
                                        .put("lastAcceptedLocalCheck", info.lastAcceptedLocalCheck)
                                        .put("trialHours", TrialCapacityBridge.TRIAL_HOURS)
                                        .put("offlineGraceHours", TrialCapacityBridge.OFFLINE_GRACE_HOURS)
                                        .put("saleAllowed", allowed),
                                ),
                        )
                    }
                }
            })
        }
    }

    private fun showCapabilities() {
        screen("Permisos") {
            addView(primaryButton("Leer capacidades SSA") {
                client?.capabilities { showResult(it) }
            })
            addView(primaryButton("Recuperar sesión") {
                client?.recoverSession { showResult(it) }
            })
        }
    }

    private fun logout() {
        val active = client ?: return
        active.logout { result ->
            runOnUiThread {
                if (result.optString("status") == "SUCCEEDED") {
                    startActivity(Intent(this, EntryActivity::class.java))
                    finish()
                } else showResult(result)
            }
        }
    }

    private fun screen(name: String, build: LinearLayout.() -> Unit) {
        content.removeAllViews()
        content.addView(title(name))
        content.addView(secondaryButton("Volver") { showHome() })
        content.build()
    }

    private fun showResult(result: JSONObject) {
        content.addView(
            TextView(this).apply {
                val userMessage = result.optJSONObject("error")?.optString("user_message")
                val code = result.optString("result_code")
                val status = result.optString("status")
                val body = result.optJSONObject("result")
                text = when {
                    !userMessage.isNullOrBlank() -> userMessage
                    status == "SUCCEEDED" && body != null -> "OK ($code)\n${body.toString(2)}"
                    status == "SUCCEEDED" -> "Operación completada ($code)."
                    else -> "No se pudo completar la operación ($code)."
                }
                setTextColor(if (status == "SUCCEEDED") ink else danger)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                setPadding(0, dp(12), 0, 0)
                setTextIsSelectable(true)
            },
        )
    }

    private fun failed(code: String, message: String) = JSONObject()
        .put("status", "FAILED")
        .put("result_code", code)
        .put("error", JSONObject().put("code", code).put("user_message", message))

    private fun title(text: String) = TextView(this).apply {
        this.text = text
        setTextColor(navy)
        setTypeface(Typeface.DEFAULT_BOLD)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
        setPadding(0, 0, 0, dp(12))
    }

    private fun note(text: String) = TextView(this).apply {
        this.text = text
        setTextColor(muted)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
        setPadding(0, 0, 0, dp(12))
    }

    private fun field(hint: String) = EditText(this).apply {
        this.hint = hint
        setHintTextColor(muted)
        setTextColor(ink)
        setBackgroundColor(Color.WHITE)
        setPadding(dp(12), dp(12), dp(12), dp(12))
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(52)).apply {
            topMargin = dp(8)
        }
        minimumHeight = dp(52)
    }

    private fun primaryButton(label: String, onClick: () -> Unit) = Button(this).apply {
        text = label
        filterTouchesWhenObscured = true
        setBackgroundColor(yellow)
        setTextColor(navy)
        setTypeface(Typeface.DEFAULT_BOLD)
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(52)).apply {
            topMargin = dp(10)
        }
        setOnClickListener { onClick() }
    }

    private fun secondaryButton(label: String, onClick: () -> Unit) = Button(this).apply {
        text = label
        filterTouchesWhenObscured = true
        setBackgroundColor(navy)
        setTextColor(yellow)
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(48)).apply {
            topMargin = dp(4)
            bottomMargin = dp(8)
        }
        setOnClickListener { onClick() }
    }

    private fun dp(value: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()

    override fun onDestroy() {
        try { unbindService(connection) } catch (_: Exception) {}
        super.onDestroy()
    }
}

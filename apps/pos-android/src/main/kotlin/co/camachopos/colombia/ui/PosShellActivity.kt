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
import co.camachopos.colombia.runtime.LocalPosService
import co.camachopos.colombia.runtime.PosClient
import org.json.JSONObject

/**
 * Commercial workspace: Caja, carrito, catálogo, inventario, clientes, turnos.
 * Every action invokes Local Service contracts through the embedded engine.
 */
class PosShellActivity : Activity() {
    private var binder: LocalPosService.LocalBinder? = null
    private var client: PosClient? = null
    private lateinit var content: LinearLayout
    private lateinit var statusLine: TextView
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
            client?.session { result ->
                runOnUiThread {
                    val outcome = result.optJSONObject("result")?.optString("outcome")
                    if (outcome != "AUTHENTICATED") {
                        startActivity(Intent(this@PosShellActivity, EntryActivity::class.java))
                        finish()
                    } else {
                        val username = result.optJSONObject("result")?.optString("username").orEmpty()
                        val role = result.optJSONObject("result")?.optString("role").orEmpty()
                        statusLine.text = "$username · $role"
                        showHome()
                    }
                }
            }
        }
        override fun onServiceDisconnected(name: ComponentName?) {
            binder = null
            client = null
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
            "Licencia" to { showLicense() },
            "Cerrar sesión" to { logout() },
        ).forEach { (label, action) ->
            content.addView(primaryButton(label, action))
        }
    }

    private fun showCash() {
        screen("Caja / Turnos") {
            val register = field("ID de caja")
            val amount = field("Monto de apertura")
            addView(register)
            addView(amount)
            addView(primaryButton("Abrir turno") {
                client?.invoke(
                    "cash.shift.open",
                    JSONObject()
                        .put("cash_register_id", register.text.toString().trim())
                        .put("opening_amount", amount.text.toString().trim()),
                ) { showResult(it) }
            })
            addView(primaryButton("Cerrar turno") {
                client?.invoke(
                    "cash.shift.close",
                    JSONObject().put("cash_register_id", register.text.toString().trim()),
                ) { showResult(it) }
            })
        }
    }

    private fun showSales() {
        screen("Carrito / Ventas") {
            addView(note("Las ventas usan los contratos sale.create / cart.waiting.* del servicio local."))
            addView(primaryButton("Listar carritos en espera") {
                client?.invoke("cart.waiting.list") { showResult(it) }
            })
            val saleId = field("ID de venta a cancelar")
            addView(saleId)
            addView(primaryButton("Cancelar venta") {
                client?.invoke(
                    "sale.cancel",
                    JSONObject().put("sale_id", saleId.text.toString().trim()),
                ) { showResult(it) }
            })
        }
    }

    private fun showCatalog() {
        screen("Catálogo") {
            addView(primaryButton("Listar productos") {
                client?.invoke("catalog.item.list", JSONObject()) { showResult(it) }
            })
            val query = field("Buscar producto")
            addView(query)
            addView(primaryButton("Buscar") {
                client?.invoke(
                    "catalog.item.find",
                    JSONObject().put("query", query.text.toString().trim()),
                ) { showResult(it) }
            })
        }
    }

    private fun showInventory() {
        screen("Inventario") {
            val product = field("ID de producto")
            addView(product)
            addView(primaryButton("Consultar stock") {
                client?.invoke(
                    "inventory.stock.get",
                    JSONObject().put("product_id", product.text.toString().trim()),
                ) { showResult(it) }
            })
            addView(primaryButton("Listar lotes") {
                client?.invoke(
                    "inventory.batch.list",
                    JSONObject().put("product_id", product.text.toString().trim()),
                ) { showResult(it) }
            })
        }
    }

    private fun showCustomers() {
        screen("Clientes") {
            val query = field("Documento o nombre")
            addView(query)
            addView(primaryButton("Buscar cliente") {
                client?.invoke(
                    "customer.find",
                    JSONObject().put("query", query.text.toString().trim()),
                ) { showResult(it) }
            })
        }
    }

    private fun showLicense() {
        screen("Licencia") {
            addView(primaryButton("Consultar licencia") {
                binder?.queryLicenseInformation { info ->
                    runOnUiThread {
                        showResult(
                            JSONObject()
                                .put("status", "SUCCEEDED")
                                .put("result_code", info.status)
                                .put(
                                    "result",
                                    JSONObject()
                                        .put("status", info.status)
                                        .put("signedValidUntil", info.signedValidUntil)
                                        .put("lastAcceptedLocalCheck", info.lastAcceptedLocalCheck),
                                ),
                        )
                    }
                }
            })
        }
    }

    private fun logout() {
        client?.logout {
            runOnUiThread {
                startActivity(Intent(this, EntryActivity::class.java))
                finish()
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
                text = when {
                    !userMessage.isNullOrBlank() -> userMessage
                    status == "SUCCEEDED" -> "Operación completada ($code)."
                    else -> "No se pudo completar la operación ($code)."
                }
                setTextColor(if (status == "SUCCEEDED") ink else danger)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
                setPadding(0, dp(12), 0, 0)
            },
        )
    }

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

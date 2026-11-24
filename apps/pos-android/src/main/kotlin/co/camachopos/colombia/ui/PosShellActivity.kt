package co.camachopos.colombia.ui

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.util.TypedValue
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import co.camachopos.colombia.CommercialIdentity

/**
 * Block 3 surface scaffold: caja / catálogo / inventario / clientes / turnos.
 * Every module tile stays disabled until a real BUSINESS session and grants exist.
 * No sample catalog, cart or offline queue is fabricated here.
 */
class PosShellActivity : Activity() {
    private val yellow = Color.parseColor("#FFC400")
    private val navy = Color.parseColor("#10283D")
    private val surface = Color.parseColor("#F3F6F8")
    private val muted = Color.parseColor("#536475")
    private val danger = Color.parseColor("#9F2525")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(surface)
            setPadding(dp(20), dp(20), dp(20), dp(20))
        }
        root.addView(banner("Camacho POS · sin sesión"))
        root.addView(note("Caja, carrito, catálogo, inventario, clientes y turnos requieren sesión BUSINESS y permisos efectivos del Local Service. Esta pantalla no inventa datos ni ventas offline."))
        listOf("Caja", "Carrito / Venta", "Catálogo", "Inventario", "Clientes", "Turnos", "Sincronización").forEach { module ->
            root.addView(moduleRow(module))
        }
        setContentView(ScrollView(this).apply { addView(root); setBackgroundColor(surface) })
    }

    private fun banner(text: String) = TextView(this).apply {
        this.text = text
        setBackgroundColor(yellow)
        setTextColor(navy)
        setTypeface(Typeface.DEFAULT_BOLD)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
        setPadding(dp(16), dp(16), dp(16), dp(16))
    }

    private fun note(text: String) = TextView(this).apply {
        this.text = text
        setTextColor(danger)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
        setPadding(0, dp(16), 0, dp(8))
    }

    private fun moduleRow(name: String) = TextView(this).apply {
        text = "$name — bloqueado (sin grants)"
        setTextColor(muted)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
        setPadding(dp(12), dp(14), dp(12), dp(14))
        setBackgroundColor(Color.WHITE)
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
            topMargin = dp(8)
        }
        contentDescription = "${CommercialIdentity.DISPLAY_NAME} $name bloqueado"
        isEnabled = false
    }

    private fun dp(value: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()
}

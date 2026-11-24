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
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import co.camachopos.colombia.CommercialIdentity
import co.camachopos.colombia.runtime.LocalPosService
import org.json.JSONObject

/**
 * Brand-first commercial entry (Commercial Precision yellow #FFC400).
 * Continues only to login; never invents a BUSINESS session from UI presence.
 */
class EntryActivity : Activity() {
    private var binder: LocalPosService.LocalBinder? = null
    private lateinit var statusView: TextView
    private val yellow = Color.parseColor("#FFC400")
    private val navy = Color.parseColor("#10283D")
    private val ink = Color.parseColor("#142B3A")
    private val muted = Color.parseColor("#536475")
    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            binder = service as LocalPosService.LocalBinder
            renderStatus()
        }
        override fun onServiceDisconnected(name: ComponentName?) {
            binder = null
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = dp(28)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(yellow)
            setPadding(pad, pad, pad, pad)
            gravity = Gravity.CENTER_HORIZONTAL
        }
        val brand = ImageView(this).apply {
            adjustViewBounds = true
            contentDescription = CommercialIdentity.DISPLAY_NAME
            scaleType = ImageView.ScaleType.FIT_CENTER
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(96)).apply {
                topMargin = dp(48)
            }
            runCatching {
                assets.open("brand_lockup.png").use { setImageBitmap(BitmapFactory.decodeStream(it)) }
            }
        }
        val title = TextView(this).apply {
            text = CommercialIdentity.DISPLAY_NAME
            setTextColor(navy)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 28f)
            setTypeface(Typeface.DEFAULT_BOLD)
            gravity = Gravity.CENTER
            setPadding(0, dp(28), 0, 0)
        }
        val subtitle = TextView(this).apply {
            text = "Punto de venta local-first para Colombia"
            setTextColor(ink)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
            gravity = Gravity.CENTER
            setPadding(0, dp(12), 0, 0)
        }
        statusView = TextView(this).apply {
            text = "Acceso comercial bloqueado"
            setTextColor(muted)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            gravity = Gravity.CENTER
            setPadding(0, dp(24), 0, 0)
        }
        val continueButton = Button(this).apply {
            text = "Continuar"
            filterTouchesWhenObscured = true
            setBackgroundColor(navy)
            setTextColor(yellow)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(56)).apply {
                topMargin = dp(36)
            }
            setOnClickListener { startActivity(Intent(this@EntryActivity, LoginActivity::class.java)) }
        }
        root.addView(brand)
        root.addView(title)
        root.addView(subtitle)
        root.addView(statusView)
        root.addView(continueButton)
        setContentView(ScrollView(this).apply { addView(root); setBackgroundColor(yellow) })

        startForegroundService(Intent(this, LocalPosService::class.java))
        bindService(Intent(this, LocalPosService::class.java), connection, Context.BIND_AUTO_CREATE)
    }

    private fun renderStatus() {
        val raw = binder?.status() ?: return
        val json = JSONObject(raw)
        val access = json.optString("commercial_access", "BLOCKED_PENDING_TRUSTED_PROVISIONING")
        val state = json.optString("state", "UNKNOWN")
        statusView.text = "Acceso comercial bloqueado · $state · $access"
    }

    private fun dp(value: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()

    override fun onDestroy() {
        try { unbindService(connection) } catch (_: Exception) {}
        super.onDestroy()
    }
}

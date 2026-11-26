package co.camachopos.colombia.ui

import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
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
import co.camachopos.colombia.auth.BusinessCeremonyCoordinator
import co.camachopos.colombia.runtime.LocalPosService
import co.camachopos.colombia.runtime.PosClient
import org.json.JSONObject

/**
 * Commercial entry: Windows yellow identity + BUSINESS ceremony only.
 * local.operator.login is intentionally absent — it must not authorize commerce.
 */
class EntryActivity : Activity() {
    private var binder: LocalPosService.LocalBinder? = null
    private var client: PosClient? = null
    private lateinit var messageView: TextView
    private lateinit var loginButton: Button
    private val yellow = Color.parseColor("#FFC400")
    private val navy = Color.parseColor("#10283D")
    private val navyDeep = Color.parseColor("#061C30")
    private val ink = Color.parseColor("#142B3A")
    private val muted = Color.parseColor("#536475")
    private val surface = Color.parseColor("#F3F6F8")
    private val danger = Color.parseColor("#9F2525")
    private val connection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            binder = service as LocalPosService.LocalBinder
            client = PosClient(binder!!)
            if (resumeExchangeIfPresent()) return
            client?.recoverSession { result ->
                runOnUiThread {
                    if (PosClient.isSessionRecovered(result)) openWorkspace()
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
        val brandStage = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            background = GradientDrawable(
                GradientDrawable.Orientation.TL_BR,
                intArrayOf(navyDeep, Color.parseColor("#0A2F4F"), Color.parseColor("#071F35")),
            )
            setPadding(dp(24), dp(36), dp(24), dp(36))
        }
        val brand = ImageView(this).apply {
            adjustViewBounds = true
            contentDescription = CommercialIdentity.DISPLAY_NAME
            scaleType = ImageView.ScaleType.FIT_CENTER
            layoutParams = LinearLayout.LayoutParams(dp(280), dp(100))
            runCatching {
                assets.open("brand_lockup.png").use { setImageBitmap(BitmapFactory.decodeStream(it)) }
            }
        }
        val tagline = TextView(this).apply {
            text = "Tecnología que impulsa tu negocio"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
            setTypeface(Typeface.DEFAULT_BOLD)
            gravity = Gravity.CENTER
            setPadding(0, dp(18), 0, 0)
        }
        val support = TextView(this).apply {
            text = "Gestiona tus operaciones con precisión, seguridad y confianza."
            setTextColor(Color.parseColor("#E7EEF4"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            gravity = Gravity.CENTER
            setPadding(0, dp(8), 0, 0)
        }
        brandStage.addView(brand)
        brandStage.addView(tagline)
        brandStage.addView(support)

        val form = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(24), dp(24), dp(24))
        }
        val eyebrow = TextView(this).apply {
            text = "CAMACHO POS COLOMBIA"
            setTextColor(muted)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            setTypeface(Typeface.DEFAULT_BOLD)
        }
        val title = TextView(this).apply {
            text = "Iniciar sesión"
            setTextColor(navy)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 28f)
            setTypeface(Typeface.DEFAULT_BOLD)
            setPadding(0, dp(8), 0, 0)
        }
        val lead = TextView(this).apply {
            text = "Acceso BUSINESS con Central, DeviceProof, App Links y SSA."
            setTextColor(ink)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            setPadding(0, dp(8), 0, 0)
        }
        messageView = TextView(this).apply {
            text = ""
            setTextColor(danger)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setPadding(0, dp(12), 0, 0)
        }
        loginButton = Button(this).apply {
            text = "Ingresar con BUSINESS"
            filterTouchesWhenObscured = true
            setBackgroundColor(yellow)
            setTextColor(navy)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            setTypeface(Typeface.DEFAULT_BOLD)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(56)).apply {
                topMargin = dp(16)
            }
            setOnClickListener { startBusiness() }
        }
        form.addView(eyebrow)
        form.addView(title)
        form.addView(lead)
        form.addView(loginButton)
        form.addView(messageView)
        root.addView(brandStage)
        root.addView(form)
        setContentView(ScrollView(this).apply { addView(root); setBackgroundColor(surface) })

        startForegroundService(Intent(this, LocalPosService::class.java))
        bindService(Intent(this, LocalPosService::class.java), connection, Context.BIND_AUTO_CREATE)
    }

    override fun onResume() {
        super.onResume()
        resumeExchangeIfPresent()
    }

    private fun startBusiness() {
        val activeBinder = binder
        if (activeBinder == null) {
            messageView.setTextColor(danger)
            messageView.text = "El servicio local aún no está listo."
            return
        }
        loginButton.isEnabled = false
        messageView.setTextColor(muted)
        messageView.text = "Verificando App Links…"
        val clientId = activeBinder.businessClientId().ifBlank { "android-commercial" }
        BusinessCeremonyCoordinator.prepare(this, clientId) { outcome ->
            if (!outcome.ok || outcome.prepared == null) {
                loginButton.isEnabled = true
                messageView.setTextColor(danger)
                messageView.text = outcome.userMessage
                return@prepare
            }
            val material = outcome.prepared.material
            messageView.text = "Registrando solicitud nativa con DeviceProof…"
            activeBinder.registerNativeBusinessRequest(
                JSONObject()
                    .put("client_id", material.clientId)
                    .put("redirect_uri", material.redirectUri)
                    .put("code_challenge", material.codeChallenge)
                    .put("code_challenge_method", material.codeChallengeMethod)
                    .put("state", material.state)
                    .put("purpose", "BUSINESS_NATIVE_AUTHORIZATION_V1"),
            ) { registration ->
                runOnUiThread {
                    if (registration.optString("status") != "SUCCEEDED") {
                        loginButton.isEnabled = true
                        messageView.setTextColor(danger)
                        val userMessage = registration.optJSONObject("error")?.optString("user_message")
                        messageView.text = if (!userMessage.isNullOrBlank()) userMessage
                        else "Central no emitió el selector request. Sin DeviceProof enrolado no hay acceso BUSINESS."
                        return@runOnUiThread
                    }
                    val selector = registration.optJSONObject("result")?.optString("request")
                    if (selector.isNullOrBlank() || !selector.matches(Regex("^[A-Za-z0-9_-]{43}$"))) {
                        loginButton.isEnabled = true
                        messageView.setTextColor(danger)
                        messageView.text = "Central no devolvió un selector request válido."
                        return@runOnUiThread
                    }
                    BusinessCeremonyCoordinator.openBrowser(this, selector) { browser ->
                        loginButton.isEnabled = true
                        messageView.setTextColor(if (browser.ok) ink else danger)
                        messageView.text = browser.userMessage
                    }
                }
            }
        }
    }

    private fun resumeExchangeIfPresent(): Boolean {
        val activeBinder = binder ?: return false
        val exchange = activeBinder.takeBusinessAuthorizationCode() ?: return false
        messageView.setTextColor(muted)
        messageView.text = "Código recibido. Canjeando con DeviceProof…"
        activeBinder.depositBusinessExchange(exchange)
        activeBinder.completeBusinessTokenExchange { tokenResult ->
            runOnUiThread {
                if (tokenResult.optString("status") != "SUCCEEDED") {
                    messageView.setTextColor(danger)
                    val userMessage = tokenResult.optJSONObject("error")?.optString("user_message")
                    messageView.text = if (!userMessage.isNullOrBlank()) userMessage
                    else "No se pudo canjear el código BUSINESS."
                    return@runOnUiThread
                }
                openWorkspace()
            }
        }
        return true
    }

    private fun openWorkspace() {
        if (isFinishing || isDestroyed) return
        startActivity(Intent(this, PosShellActivity::class.java))
        finish()
    }

    private fun dp(value: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()

    override fun onDestroy() {
        try { unbindService(connection) } catch (_: Exception) {}
        super.onDestroy()
    }
}

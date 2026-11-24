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
import android.text.InputType
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

/**
 * Commercial entry matching Windows Commercial Precision identity:
 * navy brand stage, official lockup, yellow primary action.
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
            client?.session { result ->
                runOnUiThread {
                    val outcome = result.optJSONObject("result")?.optString("outcome")
                    if (outcome == "AUTHENTICATED") openWorkspace()
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
            text = "Ingresa a tu espacio de trabajo."
            setTextColor(ink)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            setPadding(0, dp(8), 0, 0)
        }
        val username = EditText(this).apply {
            hint = "Usuario"
            setHintTextColor(muted)
            setTextColor(ink)
            setBackgroundColor(Color.WHITE)
            setPadding(dp(14), dp(14), dp(14), dp(14))
            inputType = InputType.TYPE_CLASS_TEXT
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(56)).apply {
                topMargin = dp(20)
            }
            minimumHeight = dp(56)
        }
        val password = EditText(this).apply {
            hint = "Contraseña"
            setHintTextColor(muted)
            setTextColor(ink)
            setBackgroundColor(Color.WHITE)
            setPadding(dp(14), dp(14), dp(14), dp(14))
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(56)).apply {
                topMargin = dp(12)
            }
            minimumHeight = dp(56)
        }
        messageView = TextView(this).apply {
            text = ""
            setTextColor(danger)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setPadding(0, dp(12), 0, 0)
        }
        loginButton = Button(this).apply {
            text = "Ingresar"
            filterTouchesWhenObscured = true
            setBackgroundColor(yellow)
            setTextColor(navy)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            setTypeface(Typeface.DEFAULT_BOLD)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(56)).apply {
                topMargin = dp(16)
            }
            setOnClickListener {
                val user = username.text?.toString()?.trim().orEmpty()
                val pass = password.text?.toString().orEmpty()
                if (user.isEmpty() || pass.isEmpty()) {
                    messageView.text = "Completa usuario y contraseña."
                    return@setOnClickListener
                }
                val active = client
                if (active == null) {
                    messageView.text = "El servicio local aún no está listo."
                    return@setOnClickListener
                }
                isEnabled = false
                messageView.setTextColor(muted)
                messageView.text = "Validando sesión…"
                active.login(user, pass) { result ->
                    runOnUiThread {
                        isEnabled = true
                        val body = result.optJSONObject("result")
                        val outcome = body?.optString("outcome")
                        when (outcome) {
                            "AUTHENTICATED" -> openWorkspace()
                            "DENIED" -> {
                                messageView.setTextColor(danger)
                                messageView.text = "Usuario o contraseña incorrectos."
                            }
                            "RATE_LIMITED" -> {
                                messageView.setTextColor(danger)
                                messageView.text = "Demasiados intentos. Espera unos minutos."
                            }
                            else -> {
                                messageView.setTextColor(danger)
                                val userMessage = result.optJSONObject("error")?.optString("user_message")
                                messageView.text = if (!userMessage.isNullOrBlank()) userMessage
                                else "No se pudo iniciar sesión en este dispositivo."
                            }
                        }
                    }
                }
            }
        }
        form.addView(eyebrow)
        form.addView(title)
        form.addView(lead)
        form.addView(username)
        form.addView(password)
        form.addView(loginButton)
        form.addView(messageView)
        root.addView(brandStage)
        root.addView(form)
        setContentView(ScrollView(this).apply { addView(root); setBackgroundColor(surface) })

        startForegroundService(Intent(this, LocalPosService::class.java))
        bindService(Intent(this, LocalPosService::class.java), connection, Context.BIND_AUTO_CREATE)
    }

    private fun openWorkspace() {
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

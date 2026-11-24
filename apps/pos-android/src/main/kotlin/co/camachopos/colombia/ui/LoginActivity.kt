package co.camachopos.colombia.ui

import android.app.Activity
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Typeface
import android.os.Bundle
import android.text.InputType
import android.util.TypedValue
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import co.camachopos.colombia.CommercialIdentity

/**
 * Touch-oriented commercial login shell (Block 2 scaffold).
 * No mock success: without trusted provisioning and BUSINESS ceremony the gate stays closed.
 */
class LoginActivity : Activity() {
    private val yellow = Color.parseColor("#FFC400")
    private val navy = Color.parseColor("#10283D")
    private val surface = Color.parseColor("#F3F6F8")
    private val card = Color.WHITE
    private val ink = Color.parseColor("#142B3A")
    private val muted = Color.parseColor("#536475")
    private val danger = Color.parseColor("#9F2525")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = dp(24)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(surface)
            setPadding(pad, pad, pad, pad)
        }
        root.addView(android.view.View(this).apply {
            setBackgroundColor(yellow)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(8))
        })
        val brand = ImageView(this).apply {
            adjustViewBounds = true
            contentDescription = CommercialIdentity.DISPLAY_NAME
            scaleType = ImageView.ScaleType.FIT_START
            layoutParams = LinearLayout.LayoutParams(dp(180), dp(64)).apply { topMargin = dp(24) }
            runCatching {
                assets.open("brand_lockup.png").use { setImageBitmap(BitmapFactory.decodeStream(it)) }
            }
        }
        val title = TextView(this).apply {
            text = "Acceso comercial"
            setTextColor(navy)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 24f)
            setTypeface(Typeface.DEFAULT_BOLD)
            setPadding(0, dp(20), 0, 0)
        }
        val username = EditText(this).apply {
            hint = "Usuario"
            setHintTextColor(muted)
            setTextColor(ink)
            setBackgroundColor(card)
            setPadding(dp(14), dp(14), dp(14), dp(14))
            inputType = InputType.TYPE_CLASS_TEXT
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(56)).apply {
                topMargin = dp(24)
            }
            minimumHeight = dp(56)
        }
        val password = EditText(this).apply {
            hint = "Contraseña"
            setHintTextColor(muted)
            setTextColor(ink)
            setBackgroundColor(card)
            setPadding(dp(14), dp(14), dp(14), dp(14))
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(56)).apply {
                topMargin = dp(12)
            }
            minimumHeight = dp(56)
        }
        val message = TextView(this).apply {
            text = "Sin aprovisionamiento confiable ni sesión BUSINESS. El acceso permanece cerrado."
            setTextColor(danger)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setPadding(0, dp(16), 0, 0)
        }
        val login = Button(this).apply {
            text = "Ingresar"
            filterTouchesWhenObscured = true
            setBackgroundColor(yellow)
            setTextColor(navy)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(56)).apply {
                topMargin = dp(20)
            }
            setOnClickListener {
                username.text?.clear()
                password.text?.clear()
                message.text = "Sin aprovisionamiento confiable ni sesión BUSINESS. El acceso permanece cerrado."
            }
        }
        root.addView(brand)
        root.addView(title)
        root.addView(username)
        root.addView(password)
        root.addView(login)
        root.addView(message)
        setContentView(ScrollView(this).apply { addView(root); setBackgroundColor(surface) })
    }

    private fun dp(value: Int): Int =
        TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()
}

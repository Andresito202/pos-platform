package co.camachopos.colombia.auth

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle

/**
 * Same-UID native custody only. No renderer or network endpoint can install
 * pending state. Commercial entry prepares PKCE, registers the native request
 * with DeviceProof against Central, then opens the V2 browser URL.
 */
object AndroidBusinessAuthorizationHost {
    private var pending: AndroidPendingBusinessAuthorization? = null
    private var exchange: AndroidPendingBusinessAuthorization.Exchange? = null
    private var deadline = 0L
    private var association: VerifiedAndroidBusinessAppLink? = null

    @Synchronized
    fun prepare(
        association: VerifiedAndroidBusinessAppLink,
        lifetimeMs: Long,
    ): AndroidPendingBusinessAuthorization.PkceMaterial {
        cancel()
        require(lifetimeMs > 0)
        this.association = association
        val created = AndroidPendingBusinessAuthorization(association.registration, lifetimeMs)
        val material = created.prepare()
        pending = created
        deadline = System.nanoTime() / 1_000_000 + lifetimeMs
        return material
    }

    @Synchronized
    fun openBrowser(context: Context, requestSelector: String) {
        val active = pending ?: error("BUSINESS_PKCE_NOT_PREPARED")
        val verified = association ?: error("BUSINESS_ASSOCIATION_MISSING")
        verified.openSystemBrowserWithRequest(context, active, requestSelector)
    }

    /** Test / lab helper that opens the legacy PKCE URL. Not commercial entry. */
    @Synchronized
    fun begin(context: Context, association: VerifiedAndroidBusinessAppLink, lifetimeMs: Long) {
        cancel()
        require(lifetimeMs > 0)
        this.association = association
        pending = association.openSystemBrowser(context, lifetimeMs)
        deadline = System.nanoTime() / 1_000_000 + lifetimeMs
    }

    @Synchronized
    fun acceptCallback(value: String?): Boolean {
        if (value == null) return false
        val consumed = pending?.consume(value) ?: return false
        pending = null
        exchange = consumed
        return true
    }

    @Synchronized
    fun takeForNativeExchange(): AndroidPendingBusinessAuthorization.Exchange? {
        if (System.nanoTime() / 1_000_000 >= deadline) {
            cancel()
            return null
        }
        val consumed = exchange
        exchange = null
        return consumed
    }

    @Synchronized
    fun cancel() {
        pending?.cancel()
        pending = null
        exchange = null
        association = null
        deadline = 0
    }
}

/** Manifest attaches the verified HTTPS App Link filter. Always finishes. */
class BusinessAuthorizationCallbackActivity : Activity() {
    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        receive(intent)
    }

    override fun onNewIntent(value: Intent?) {
        super.onNewIntent(value)
        receive(value)
    }

    private fun receive(value: Intent?) {
        if (value?.action == Intent.ACTION_VIEW) {
            AndroidBusinessAuthorizationHost.acceptCallback(value.dataString)
        }
        finish()
    }
}

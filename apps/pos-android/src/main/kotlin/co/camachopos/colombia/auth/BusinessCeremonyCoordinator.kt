package co.camachopos.colombia.auth

import android.content.Context
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import co.camachopos.colombia.CommercialIdentity
import java.security.MessageDigest
import java.util.concurrent.Executors

/**
 * BUSINESS App Link + PKCE preparation. local.operator.login is never used.
 *
 * Opening the browser requires a Central native-request selector produced after
 * DeviceProof registration. That Central route is not simulated.
 */
object BusinessCeremonyCoordinator {
    private val worker = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

    data class Prepared(
        val material: AndroidPendingBusinessAuthorization.PkceMaterial,
        val certificateSha256: String,
    )

    data class Outcome(
        val ok: Boolean,
        val code: String,
        val userMessage: String,
        val prepared: Prepared? = null,
    )

    fun installedSignerSha256(context: Context): String {
        val info = context.packageManager.getPackageInfo(
            context.packageName,
            PackageManager.GET_SIGNING_CERTIFICATES,
        )
        val signatures = info.signingInfo?.apkContentsSigners ?: error("ANDROID_SIGNER_UNAVAILABLE")
        check(signatures.size == 1) { "ANDROID_SIGNER_AMBIGUOUS" }
        return MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray())
            .joinToString(":") { "%02X".format(it.toInt() and 255) }
    }

    /** Verifies DAL association and prepares PKCE custody for DeviceProof registration. */
    fun prepare(
        context: Context,
        clientId: String,
        lifetimeMs: Long = 120_000L,
        associationTimeoutMs: Int = 8_000,
        callback: (Outcome) -> Unit,
    ) {
        worker.execute {
            try {
                check(context.packageName == CommercialIdentity.APPLICATION_ID)
                val fingerprint = installedSignerSha256(context)
                val registration = AndroidNativeRegistration.camacho(
                    clientId,
                    CommercialIdentity.APPLICATION_ID,
                    fingerprint,
                )
                val association = VerifiedAndroidBusinessAppLink.verify(
                    context,
                    registration,
                    associationTimeoutMs,
                )
                val material = AndroidBusinessAuthorizationHost.prepare(association, lifetimeMs)
                main.post {
                    callback(
                        Outcome(
                            true,
                            "PKCE_PREPARED",
                            "Solicitud local lista. Registra la posesión DeviceProof ante Central para obtener el selector request.",
                            Prepared(material, fingerprint),
                        ),
                    )
                }
            } catch (error: Exception) {
                val code = error.message?.takeIf { it.matches(Regex("[A-Z0-9_]{8,80}")) }
                    ?: "BUSINESS_CEREMONY_FAILED"
                main.post {
                    callback(
                        Outcome(
                            false,
                            code,
                            when (code) {
                                "ANDROID_ASSET_LINKS_ASSOCIATION_REJECTED",
                                "ANDROID_ASSET_LINKS_HTTP_REJECTED",
                                "ANDROID_ASSET_LINKS_MEDIA_REJECTED",
                                -> "La asociación App Links con Central no está publicada o no coincide con esta APK."
                                "ANDROID_SIGNER_MISMATCH" ->
                                    "El certificado de esta APK no coincide con el registro BUSINESS."
                                else -> "No se pudo preparar el acceso BUSINESS en este dispositivo."
                            },
                        ),
                    )
                }
            }
        }
    }

    fun openBrowser(context: Context, requestSelector: String, callback: (Outcome) -> Unit) {
        worker.execute {
            try {
                AndroidBusinessAuthorizationHost.openBrowser(context, requestSelector)
                main.post {
                    callback(
                        Outcome(
                            true,
                            "BROWSER_OPENED",
                            "Completa el acceso BUSINESS en el navegador del sistema.",
                        ),
                    )
                }
            } catch (error: Exception) {
                val code = error.message?.takeIf { it.matches(Regex("[A-Z0-9_]{8,80}")) }
                    ?: "BUSINESS_BROWSER_FAILED"
                main.post {
                    callback(
                        Outcome(
                            false,
                            code,
                            if (code == "ANDROID_SYSTEM_BROWSER_UNAVAILABLE") {
                                "No hay un navegador del sistema disponible."
                            } else {
                                "No se pudo abrir el navegador BUSINESS."
                            },
                        ),
                    )
                }
            }
        }
    }
}

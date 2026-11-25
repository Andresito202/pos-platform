package co.camachopos.colombia.security

import android.content.Context
import android.content.pm.ApplicationInfo
import android.os.Debug
import java.io.File

/**
 * API 28-compatible host integrity signals for BUSINESS ceremony.
 * Fail-closed for new BUSINESS authority only — does not revoke an already
 * activated offline sale path mid-transaction. No Play Integrity dependency.
 */
object AndroidRuntimeIntegrity {
    data class Finding(val code: String, val detail: String)

    fun evaluate(context: Context): List<Finding> {
        val findings = ArrayList<Finding>(8)
        val appInfo = context.applicationInfo
        if ((appInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
            findings += Finding("ANDROID_DEBUGGABLE_BUILD", "application is debuggable")
        }
        if (Debug.isDebuggerConnected() || Debug.waitingForDebugger()) {
            findings += Finding("ANDROID_DEBUGGER_ATTACHED", "debugger connected")
        }
        if (File("/proc/self/status").takeIf { it.canRead() }?.readText()?.lines()
                ?.any { it.startsWith("TracerPid:") && it.substringAfter(":").trim() != "0" } == true
        ) {
            findings += Finding("ANDROID_TRACER_ATTACHED", "TracerPid non-zero")
        }
        val suspiciousPaths = listOf(
            "/data/local/tmp/frida-server",
            "/data/local/tmp/re.frida.server",
            "/sbin/su",
            "/system/bin/su",
            "/system/xbin/su",
            "/system/app/Superuser.apk",
            "/system/app/SuperSU.apk",
        )
        for (path in suspiciousPaths) {
            if (File(path).exists()) {
                findings += Finding("ANDROID_TAMPER_ARTIFACT", path)
            }
        }
        val maps = File("/proc/self/maps").takeIf { it.canRead() }?.readText().orEmpty()
        val hooks = listOf("frida", "xposed", "substrate", "libgadget")
        for (token in hooks) {
            if (maps.contains(token, ignoreCase = true)) {
                findings += Finding("ANDROID_HOOK_FRAMEWORK", token)
            }
        }
        return findings
    }

    /** Throws a stable uppercase code when BUSINESS must not proceed. */
    fun requireBusinessSafe(context: Context) {
        val findings = evaluate(context)
        if (findings.isEmpty()) return
        val critical = findings.firstOrNull {
            it.code == "ANDROID_DEBUGGABLE_BUILD"
                || it.code == "ANDROID_DEBUGGER_ATTACHED"
                || it.code == "ANDROID_TRACER_ATTACHED"
                || it.code == "ANDROID_HOOK_FRAMEWORK"
                || it.code == "ANDROID_TAMPER_ARTIFACT"
        } ?: return
        throw IllegalStateException(critical.code)
    }
}

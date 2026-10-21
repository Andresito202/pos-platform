package co.camachopos.hardware

import android.app.Service
import android.content.Intent
import android.os.Binder
import android.os.IBinder
import android.os.Process

/** Same-UID bound service. No unauthenticated LAN endpoint or browser command surface. */
class HardwareBridgeService : Service() {
    private var bridge: AuthorizedHardwareBridge? = null
    inner class LocalBinder : Binder() {
        fun bindVerifiedRuntime(runtime: AuthorizedHardwareBridge) {
            require(Binder.getCallingUid() == Process.myUid()) { "HARDWARE_CALLER_REJECTED" }
            bridge = runtime
        }
        fun execute(intent: HardwareIntent): JobState? {
            require(Binder.getCallingUid() == Process.myUid()) { "HARDWARE_CALLER_REJECTED" }
            return (bridge ?: error("AUTHORIZATION_RUNTIME_NOT_BOUND")).execute(intent)
        }
    }
    override fun onBind(intent: Intent?): IBinder = LocalBinder()
    override fun onDestroy() { bridge = null; super.onDestroy() }
}

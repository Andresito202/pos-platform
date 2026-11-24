package co.camachopos.android

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Bundle

/** Same-UID native custody only. No renderer or network endpoint can install
 * pending state. The current probe does not export/register this App Link. */
object AndroidBusinessAuthorizationHost {
    private var pending:AndroidPendingBusinessAuthorization?=null
    private var exchange:AndroidPendingBusinessAuthorization.Exchange?=null
    private var deadline=0L
    @Synchronized fun begin(context:Context,association:VerifiedAndroidBusinessAppLink,lifetimeMs:Long) {
        cancel();require(lifetimeMs>0)
        // The lock prevents an immediate callback racing state installation.
        pending=association.openSystemBrowser(context,lifetimeMs)
        deadline=System.nanoTime()/1_000_000+lifetimeMs
    }
    @Synchronized fun acceptCallback(value:String?):Boolean {
        if(value==null)return false
        val consumed=pending?.consume(value)?:return false
        pending=null;exchange=consumed;return true
    }
    @Synchronized fun takeForNativeExchange():AndroidPendingBusinessAuthorization.Exchange? {
        if(System.nanoTime()/1_000_000>=deadline){cancel();return null}
        val consumed=exchange;exchange=null;return consumed
    }
    @Synchronized fun cancel(){pending?.cancel();pending=null;exchange=null;deadline=0}
}

/** A future approved manifest can attach its exact verified HTTPS filter.
 * Always finishes, never displays credentials, logs URLs or loads a WebView. */
class BusinessAuthorizationCallbackActivity:Activity() {
    override fun onCreate(state:Bundle?){super.onCreate(state);receive(intent)}
    override fun onNewIntent(value:Intent?){super.onNewIntent(value);receive(value)}
    private fun receive(value:Intent?){
        if(value?.action==Intent.ACTION_VIEW)AndroidBusinessAuthorizationHost.acceptCallback(value.dataString)
        finish()
    }
}

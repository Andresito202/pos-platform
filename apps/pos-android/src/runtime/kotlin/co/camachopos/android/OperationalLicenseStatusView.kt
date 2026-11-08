package co.camachopos.android

import android.content.Context
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/** No WebView, URI, Linkify, browser Intent, checkout or payment dependency. */
class OperationalLicenseStatusView(context:Context,refresh:()->Unit):LinearLayout(context) {
    private val heading=TextView(context).apply { textSize=18f }
    private val explanation=TextView(context).apply { autoLinkMask=0;linksClickable=false;movementMethod=null }
    private val details=TextView(context).apply { autoLinkMask=0;linksClickable=false;movementMethod=null }
    init {
        orientation=VERTICAL;addView(heading);addView(explanation);addView(details)
        addView(Button(context).apply {text="Consultar estado de licencia";filterTouchesWhenObscured=true;setOnClickListener {refresh()} })
        show(OperationalLicenseInformation.unverified())
    }
    fun show(information:OperationalLicenseInformation){
        heading.text=information.title();explanation.text=information.message();details.text=information.details()
    }
}

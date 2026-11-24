package co.camachopos.android

/** One bounded, correlated read on the inherited child pipe. No cached state
 * survives channel loss and no transport response grants commercial access. */
internal class AndroidLicenseQuery(private val now:()->Long,private val timeoutMs:Long=2000) {
    private var sequence=0
    private var pending:((OperationalLicenseInformation)->Unit)?=null
    private var deadline=0L
    @Synchronized fun begin(callback:(OperationalLicenseInformation)->Unit):Int? {
        expire()
        if(pending!=null||sequence>=999999999){callback(OperationalLicenseInformation.unverified());return null}
        sequence++;pending=callback;deadline=now()+timeoutMs;return sequence
    }
    @Synchronized fun complete(id:Int,information:OperationalLicenseInformation):Boolean {
        expire()
        if(id!=sequence||pending==null)return false
        val callback=pending!!;pending=null;callback(information);return true
    }
    @Synchronized fun expire(){if(pending!=null&&now()>=deadline)cancel()}
    @Synchronized fun cancel(){val callback=pending;pending=null;callback?.invoke(OperationalLicenseInformation.unverified())}
}

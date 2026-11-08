package co.camachopos.android

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import org.json.JSONArray
import java.net.URI
import java.net.URLDecoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.net.ssl.HttpsURLConnection

/** Registration metadata only; never user/device authentication or D3 approval. */
data class AndroidNativeRegistration(val clientId:String,val origin:String,val callback:String,val packageId:String,val certificateSha256:String) {
    companion object {
        /** Destination preparation only; caller still needs the real release
         * signer, verified DAL, DEV-003 and native request binding. */
        fun camacho(clientId:String,packageId:String,certificateSha256:String)=AndroidNativeRegistration(
            clientId,"https://central.camachoposcolombia.com","https://central.camachoposcolombia.com/android/callback",packageId,certificateSha256)
    }
    init {
        val issuer=URI(origin);val redirect=URI(callback)
        require(clientId.matches(Regex("[A-Za-z0-9._~-]{1,128}")))
        require(issuer.scheme=="https"&&issuer.host!=null&&issuer.host.contains('.')&&issuer.host!="127.0.0.1"&&
            issuer.rawUserInfo==null&&issuer.rawQuery==null&&issuer.rawFragment==null&&issuer.rawPath.isEmpty())
        require(redirect.toASCIIString()==origin+"/android/callback")
        require(packageId.matches(Regex("[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+")))
        require(certificateSha256.matches(Regex("(?:[A-F0-9]{2}:){31}[A-F0-9]{2}")))
    }
}

/** PKCE/callback correlation only. Its output is not a session, token or grant. */
class AndroidPendingBusinessAuthorization(private val registration:AndroidNativeRegistration,private val lifetimeMs:Long,
    private val clock:()->Long={System.nanoTime()/1_000_000}) {
    private var verifier:ByteArray?=null;private var state:ByteArray?=null;private var startedAt=0L
    data class Exchange(val code:String,val verifier:String,val state:String,val clientId:String,val redirectUri:String)
    init { require(lifetimeMs>0) }
    private fun b64(value:ByteArray)=Base64.getUrlEncoder().withoutPadding().encodeToString(value)
    @Synchronized fun begin():String {
        cancel();val random=SecureRandom();verifier=ByteArray(48).also { random.nextBytes(it) };state=ByteArray(32).also { random.nextBytes(it) };startedAt=clock()
        val challenge=b64(MessageDigest.getInstance("SHA-256").digest(b64(verifier!!).toByteArray(Charsets.US_ASCII)))
        fun encode(value:String)=java.net.URLEncoder.encode(value,"UTF-8")
        return registration.origin+"/v1/commercial/login?client_id="+encode(registration.clientId)+"&redirect_uri="+encode(registration.callback)+
            "&code_challenge="+challenge+"&code_challenge_method=S256&state="+b64(state!!)
    }
    @Synchronized fun consume(callback:String):Exchange? {
        val secret=state?:return null;val codeVerifier=verifier?:return null
        val now=clock();if(now<startedAt||now-startedAt>=lifetimeMs){cancel();return null}
        if(callback.length>4096||callback.substringBefore('?')!=registration.callback)return null
        val uri=try{URI(callback)}catch(_:Exception){return null}
        if(uri.rawFragment!=null||uri.rawUserInfo!=null)return null
        val pairs=(uri.rawQuery?:return null).split('&');if(pairs.size!=2)return null
        val values=mutableMapOf<String,String>()
        for(pair in pairs){val fields=pair.split('=',limit=2);if(fields.size!=2||fields[0] !in listOf("code","state")||values.containsKey(fields[0]))return null
            values[fields[0]]=try{URLDecoder.decode(fields[1],"UTF-8")}catch(_:Exception){return null}}
        val code=values["code"]?:return null;val returned=values["state"]?:return null
        if(!code.matches(Regex("[A-Za-z0-9._~-]{16,512}"))||!returned.matches(Regex("[A-Za-z0-9_-]{43}")))return null
        val actual=try{Base64.getUrlDecoder().decode(returned)}catch(_:Exception){return null}
        if(b64(actual)!=returned||!MessageDigest.isEqual(actual,secret))return null
        val result=Exchange(code,b64(codeVerifier),b64(secret),registration.clientId,registration.callback)
        cancel();return result
    }
    @Synchronized fun cancel(){verifier?.fill(0);state?.fill(0);verifier=null;state=null;startedAt=0}
}

/** The only constructor is behind HTTPS DAL + installed APK signer verification.
 * No caller boolean substitutes association. OS intent-filter verification and
 * D3 activation remain separate; the current probe manifest has no App Link. */
class VerifiedAndroidBusinessAppLink private constructor(val registration:AndroidNativeRegistration) {
    companion object {
        fun verify(context:Context,registration:AndroidNativeRegistration,timeoutMs:Int):VerifiedAndroidBusinessAppLink {
            require(timeoutMs>0&&context.packageName==registration.packageId)
            check(android.os.Looper.myLooper()!=android.os.Looper.getMainLooper()) { "ANDROID_ASSOCIATION_REQUIRES_BACKGROUND_THREAD" }
            val info=context.packageManager.getPackageInfo(context.packageName,PackageManager.GET_SIGNING_CERTIFICATES)
            val signatures=info.signingInfo?.apkContentsSigners?:error("ANDROID_SIGNER_UNAVAILABLE")
            check(signatures.size==1) { "ANDROID_SIGNER_AMBIGUOUS" }
            val fingerprint=MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray()).joinToString(":") { "%02X".format(it.toInt() and 255) }
            check(fingerprint==registration.certificateSha256) { "ANDROID_SIGNER_MISMATCH" }
            val connection=URI(registration.origin+"/.well-known/assetlinks.json").toURL().openConnection() as HttpsURLConnection
            connection.sslSocketFactory=javax.net.ssl.SSLContext.getInstance("TLSv1.2").apply { init(null,null,null) }.socketFactory
            connection.instanceFollowRedirects=false;connection.connectTimeout=timeoutMs;connection.readTimeout=timeoutMs
            connection.setRequestProperty("Accept","application/json");connection.useCaches=false
            val data=try{
                check(connection.responseCode==200&&connection.url.toString()==registration.origin+"/.well-known/assetlinks.json") { "ANDROID_ASSET_LINKS_HTTP_REJECTED" }
                check(connection.contentType?.substringBefore(';')=="application/json") { "ANDROID_ASSET_LINKS_MEDIA_REJECTED" }
                connection.inputStream.use { stream->val bytes=stream.readBytesLimited(32768);String(bytes,Charsets.UTF_8) }
            }finally{connection.disconnect()}
            check(matchesAssociation(data,registration,fingerprint)) { "ANDROID_ASSET_LINKS_ASSOCIATION_REJECTED" }
            return VerifiedAndroidBusinessAppLink(registration)
        }
        /** Pure metadata check; true cannot construct a verified native owner. */
        fun matchesAssociation(data:String,registration:AndroidNativeRegistration,installedFingerprint:String):Boolean {
            if(installedFingerprint!=registration.certificateSha256||data.toByteArray(Charsets.UTF_8).size>32768)return false
            val statements=try { JSONArray(data) }catch(_:Exception){return false}
            return (0 until statements.length()).any { index->
                val statement=statements.optJSONObject(index)?:return@any false;val target=statement.optJSONObject("target")?:return@any false
                val relation=statement.optJSONArray("relation")?:return@any false
                val fingerprints=target.optJSONArray("sha256_cert_fingerprints")?:return@any false
                target.optString("namespace")=="android_app"&&target.optString("package_name")==registration.packageId&&
                    (0 until relation.length()).any { relation.optString(it)=="delegate_permission/common.handle_all_urls" }&&
                    (0 until fingerprints.length()).any { fingerprints.optString(it)==installedFingerprint }
            }
        }
        private fun java.io.InputStream.readBytesLimited(limit:Int):ByteArray {
            val output=java.io.ByteArrayOutputStream();val buffer=ByteArray(2048)
            while(true){val n=read(buffer);if(n<0)break;check(output.size()+n<=limit) { "ANDROID_ASSET_LINKS_TOO_LARGE" };output.write(buffer,0,n)}
            return output.toByteArray()
        }
    }
    fun openSystemBrowser(context:Context,lifetimeMs:Long):AndroidPendingBusinessAuthorization {
        check(context.packageName==registration.packageId)
        val pending=AndroidPendingBusinessAuthorization(registration,lifetimeMs)
        val url=pending.begin();val intent=Intent(Intent.ACTION_VIEW,android.net.Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try{
            val target=context.packageManager.resolveActivity(intent,PackageManager.MATCH_DEFAULT_ONLY)?:error("ANDROID_SYSTEM_BROWSER_UNAVAILABLE")
            check(target.activityInfo.packageName!=context.packageName) { "ANDROID_AUTH_BROWSER_CANNOT_BE_SELF" }
            context.startActivity(intent)
        }catch(error:Exception){pending.cancel();throw error}
        return pending
    }
}

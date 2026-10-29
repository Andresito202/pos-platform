package co.camachopos.android

import java.net.URI
import java.net.URLDecoder
import java.security.MessageDigest
import java.util.Base64

fun main(){
    var passed=0
    fun test(block:()->Unit){block();passed++}
    val registration=AndroidNativeRegistration("android","https://business.example.test","https://business.example.test/android/callback","co.camachopos.android",List(32){"A1"}.joinToString(":"))
    fun query(url:String)=URI(url).rawQuery.split('&').associate { val p=it.split('=',limit=2);p[0] to URLDecoder.decode(p[1],"UTF-8") }
    fun callback(state:String)=registration.callback+"?code="+"c".repeat(64)+"&state="+state
    test {
        val pending=AndroidPendingBusinessAuthorization(registration,1000);val start=query(pending.begin())
        check(start["code_challenge_method"]=="S256"&&!start.containsKey("code_verifier"))
        val result=pending.consume(callback(start["state"]!!))!!
        check(Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(result.verifier.toByteArray(Charsets.US_ASCII)))==start["code_challenge"])
        check(result.redirectUri==registration.callback&&pending.consume(callback(start["state"]!!))==null)
    }
    test {
        val pending=AndroidPendingBusinessAuthorization(registration,1000);val state=query(pending.begin())["state"]!!
        for(url in listOf(callback("x".repeat(43)),callback(state)+"&state="+state,callback(state)+"&tenant=x",callback(state)+"#leak",
            callback(state).replace("/android/callback","/callback"),callback(state).replace("https://business.example.test","http://127.0.0.1:42133")))check(pending.consume(url)==null)
        check(pending.consume(callback(state))!=null)
    }
    test { var now=100L;val pending=AndroidPendingBusinessAuthorization(registration,1000){now};val state=query(pending.begin())["state"]!!;now=1100;check(pending.consume(callback(state))==null) }
    test { var now=100L;val pending=AndroidPendingBusinessAuthorization(registration,1000){now};val state=query(pending.begin())["state"]!!;now=90;check(pending.consume(callback(state))==null) }
    test { val pending=AndroidPendingBusinessAuthorization(registration,1000);val state=query(pending.begin())["state"]!!;pending.cancel();check(pending.consume(callback(state))==null) }
    test { val pending=AndroidPendingBusinessAuthorization(registration,1000);val state=query(pending.begin())["state"]!!;check(AndroidPendingBusinessAuthorization(registration,1000).consume(callback(state))==null);val next=query(pending.begin())["state"]!!;check(state!=next&&pending.consume(callback(state))==null) }
    test { check(runCatching { registration.copy(callback="http://127.0.0.1:42133/callback") }.isFailure);check(runCatching { registration.copy(certificateSha256="missing") }.isFailure);check(runCatching { registration.copy(origin="http://business.example.test") }.isFailure) }
    val dal="""[{"relation":["delegate_permission/common.handle_all_urls"],"target":{"namespace":"android_app","package_name":"${registration.packageId}","sha256_cert_fingerprints":["${registration.certificateSha256}"]}}]"""
    test { check(VerifiedAndroidBusinessAppLink.matchesAssociation(dal,registration,registration.certificateSha256)) }
    test { check(!VerifiedAndroidBusinessAppLink.matchesAssociation(dal.replace(registration.packageId,"co.other.app"),registration,registration.certificateSha256));check(!VerifiedAndroidBusinessAppLink.matchesAssociation(dal,registration,List(32){"B2"}.joinToString(":"))) }
    test { check(!VerifiedAndroidBusinessAppLink.matchesAssociation(dal.replace("delegate_permission/common.handle_all_urls","unrelated"),registration,registration.certificateSha256));check(!VerifiedAndroidBusinessAppLink.matchesAssociation(dal.replace("android_app","web"),registration,registration.certificateSha256)) }
    test { check(!VerifiedAndroidBusinessAppLink.matchesAssociation("{",registration,registration.certificateSha256));check(!VerifiedAndroidBusinessAppLink.matchesAssociation(" ".repeat(32769),registration,registration.certificateSha256)) }
    test {
        val prepared=AndroidNativeRegistration.camacho("test-client",registration.packageId,registration.certificateSha256)
        check(prepared.origin=="https://central.camachoposcolombia.com")
        check(prepared.callback==prepared.origin+"/android/callback")
        val pending=AndroidPendingBusinessAuthorization(prepared,1000);val state=query(pending.begin())["state"]!!
        check(pending.consume(prepared.callback+"?code="+"c".repeat(64)+"&state="+state)!=null)
    }
    println("ANDROID_NATIVE_AUTH_CONTRACTS: $passed/12 PASS (JVM; no device, network or session activation)")
}

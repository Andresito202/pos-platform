package co.camachopos.hardware

import java.security.KeyPairGenerator
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.Base64
import org.json.JSONObject
import kotlin.test.*

class LabAuthorizationTest {
    @Test fun nodeDerSignatureInteroperatesWithJvmVerifier() {
        val vector=JSONObject(javaClass.getResourceAsStream("/node-signed-job.json")!!.bufferedReader().use { it.readText() })
        val b=vector.getJSONObject("binding")
        val binding=LabDeviceBinding(b.getString("installation"),b.getString("key_fingerprint"),b.getString("report_nonce"),b.getString("usb_name"),b.getString("descriptor_sha256"),b.getInt("vendor"),b.getInt("product"),b.getInt("interface_index"),b.getInt("endpoint"))
        val result=LabAuthorization.verify(vector.getJSONObject("envelope").toString(),LabAuthorization.policy(vector.getJSONObject("policy").toString()),binding,vector.getLong("now"))
        assertEquals(JobKind.PRINT,result.intent.kind);assertEquals("NODE TO JVM TEST ONLY",result.intent.reason)
    }
    private val now=1800000000000L
    private val pair=KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
    private val policy=LabPolicy(pair.public,now-1000,now+3600000,300)
    private val binding=LabDeviceBinding("test-installation","f".repeat(64),"test-nonce","/dev/bus/usb/001/002","a".repeat(64),123,456,0,1)
    private fun job():JSONObject=JSONObject().put("version","1.0.0").put("purpose","HARDWARE_PHYSICAL_LAB")
        .put("job_id","018f0000-0000-7000-8000-000000000001").put("reason","Physical test fixture only")
        .put("issued_at_ms",now-100).put("expires_at_ms",now+1000).put("kind","PRINT_TEST")
        .put("binding",JSONObject().put("installation",binding.installation).put("key_fingerprint",binding.keyFingerprint)
            .put("report_nonce",binding.reportNonce).put("usb_name",binding.usbName).put("descriptor_sha256",binding.descriptorSha256)
            .put("vendor",123).put("product",456).put("interface_index",0).put("endpoint",1))
        .put("profile",JSONObject().put("printer_model","GP-L80160").put("printer_firmware","fixture-only")
            .put("protocol","ESC_POS").put("identity_evidence","TEST ONLY").put("command_evidence","TEST ONLY")
            .put("timeout_ms",1000).put("drawer",JSONObject.NULL))
    private fun envelope(job:JSONObject,otherKey:Boolean=false):String {
        val bytes=job.toString().toByteArray(Charsets.UTF_8)
        val key=if(otherKey) KeyPairGenerator.getInstance("EC").apply { initialize(256) }.generateKeyPair().private else pair.private
        val signed=Signature.getInstance("SHA256withECDSA").run { initSign(key);update(bytes);sign() }
        return JSONObject().put("body_base64",Base64.getEncoder().encodeToString(bytes)).put("signature_base64",Base64.getEncoder().encodeToString(signed)).toString()
    }
    @Test fun signedPrintHasNoPulseOrCutter() {
        val verified=LabAuthorization.verify(envelope(job()),policy,binding,now)
        assertEquals(JobKind.PRINT,verified.intent.kind);assertFalse(verified.bytes.any { it==27.toByte()||it==29.toByte() })
    }
    @Test fun wrongSigningKeyRejected() { assertFails { LabAuthorization.verify(envelope(job(),true),policy,binding,now) } }
    @Test fun bodyMutationRejected() {
        val outer=JSONObject(envelope(job()));val changed=job().put("reason","Altered")
        outer.put("body_base64",Base64.getEncoder().encodeToString(changed.toString().toByteArray()))
        assertFails { LabAuthorization.verify(outer.toString(),policy,binding,now) }
    }
    @Test fun businessPurposeAndUnknownFieldsRejected() {
        assertFails { LabAuthorization.verify(envelope(job().put("purpose","BUSINESS")),policy,binding,now) }
        assertFails { LabAuthorization.verify(envelope(job().put("raw_bytes","G3A=")),policy,binding,now) }
    }
    @Test fun expiredAndFutureAndExcessiveLifetimeRejected() {
        assertFails { LabAuthorization.verify(envelope(job().put("expires_at_ms",now)),policy,binding,now) }
        assertFails { LabAuthorization.verify(envelope(job().put("issued_at_ms",now+1)),policy,binding,now) }
        assertFails { LabAuthorization.verify(envelope(job().put("expires_at_ms",now+400000)),policy,binding,now) }
    }
    @Test fun revokedOrExpiredAuthorityRejected() {
        assertFails { LabAuthorization.verify(envelope(job()),policy.copy(expiresAt=now),binding,now) }
    }
    @Test fun everyDeviceBindingIsRequired() {
        for(changed in listOf(binding.copy(installation="other"),binding.copy(keyFingerprint="other"),binding.copy(reportNonce="other"),binding.copy(descriptorSha256="b".repeat(64)),binding.copy(usbName="other"),binding.copy(endpoint=2))) {
            assertFails { LabAuthorization.verify(envelope(job()),policy,changed,now) }
        }
    }
    @Test fun unsignedElectricalDefaultsAreNotAvailable() {
        assertFails { LabAuthorization.verify(envelope(job().put("kind","DRAWER_OPEN")),policy,binding,now) }
        val altered=job();altered.getJSONObject("profile").put("drawer",JSONObject().put("model","CD350"))
        assertFails { LabAuthorization.verify(envelope(altered.put("kind","DRAWER_OPEN")),policy,binding,now) }
    }
    @Test fun explicitFixtureElectricalProfileProducesOnlyTheSpecifiedPulse() {
        val source=job().put("kind","DRAWER_OPEN")
        val drawer=JSONObject().put("model","CD350").put("pin",1).put("on_byte",7).put("off_byte",9)
            .put("time_unit_ms",2).put("voltage_v","12").put("electrical_evidence","SYNTHETIC TEST ONLY; NOT A DEVICE PROFILE")
        source.getJSONObject("profile").put("drawer",drawer)
        assertContentEquals(byteArrayOf(27,112,1,7,9),LabAuthorization.verify(envelope(source),policy,binding,now).bytes)
        drawer.put("pin",2);assertFails { LabAuthorization.verify(envelope(source),policy,binding,now) }
    }
    @Test fun timeoutAndCutterAndOversizedEnvelopeRejected() {
        val altered=job();altered.getJSONObject("profile").put("timeout_ms",0)
        assertFails { LabAuthorization.verify(envelope(altered),policy,binding,now) }
        assertFails { LabAuthorization.verify(envelope(job().put("kind","CUT")),policy,binding,now) }
        assertFails { LabAuthorization.verify(" ".repeat(17000),policy,binding,now) }
        val overflow=job();overflow.getJSONObject("binding").put("vendor",4294967419L)
        assertFails { LabAuthorization.verify(envelope(overflow),policy,binding,now) }
    }
    @Test fun concurrentBridgeClaimsOnlyOneEmission() {
        val verified=LabAuthorization.verify(envelope(job()),policy,binding,now)
        val ledger=object:HardwareLedger {
            var stored:JobState?=null
            override fun claim(intent:HardwareIntent):Boolean { if(stored!=null)return false;stored=JobState.DISPATCHING;return true }
            override fun finish(jobId:String,state:JobState) { stored=state }
            override fun state(jobId:String)=stored
        }
        val writes=java.util.concurrent.atomic.AtomicInteger()
        val bridge=AuthorizedHardwareBridge({ AuthorizedJob(it,verified.bytes) },ledger) { writes.incrementAndGet();JobState.TRANSPORT_ACCEPTED }
        val threads=(1..8).map { Thread { bridge.execute(verified.intent) }.apply { start() } };threads.forEach { it.join() }
        assertEquals(1,writes.get())
    }
}

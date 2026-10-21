package co.camachopos.hardware

import java.security.KeyFactory
import java.security.MessageDigest
import java.security.PublicKey
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import org.json.JSONObject

/** Offline laboratory authorization only; never authenticates a cashier or grants BUSINESS rights. */
data class LabPolicy(val publicKey: PublicKey, val notBefore: Long, val expiresAt: Long, val maxJobSeconds: Long)
data class LabDeviceBinding(val installation: String, val keyFingerprint: String, val reportNonce: String,
    val usbName: String, val descriptorSha256: String, val vendor: Int, val product: Int,
    val interfaceIndex: Int, val endpoint: Int)
data class VerifiedLabJob(val intent: HardwareIntent, val usb: UsbSelection, val bytes: ByteArray,
    val summary: String, val expiresAt: Long)
data class UsbSelection(val name: String, val vendor: Int, val product: Int, val interfaceIndex: Int,
    val endpoint: Int, val descriptorSha256: String, val timeoutMs: Int)

object LabAuthorization {
    fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    fun publicKey(base64: String): PublicKey = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(Base64.getDecoder().decode(base64)))
    private fun keys(value: JSONObject, expected: Set<String>) { require(value.keys().asSequence().toSet() == expected) { "LAB_FIELDS_REJECTED" } }
    private fun text(value: JSONObject, key: String): String {
        val item = value.get(key); require(item is String && item.isNotBlank() && item.length <= 2048) { "LAB_TEXT_REJECTED" }; return item
    }
    private fun integer(value: JSONObject, key: String): Long {
        val item = value.get(key); require(item is Int || item is Long) { "LAB_INTEGER_REJECTED" }; return (item as Number).toLong()
    }
    fun policy(json: String): LabPolicy {
        val p = JSONObject(json)
        keys(p, setOf("version", "purpose", "public_key_spki", "not_before_ms", "expires_at_ms", "max_job_seconds"))
        require(p.getString("version") == "1.0.0" && p.getString("purpose") == "HARDWARE_PHYSICAL_LAB")
        val max = integer(p, "max_job_seconds"); require(max in 1..3600)
        return LabPolicy(publicKey(text(p,"public_key_spki")),integer(p,"not_before_ms"),integer(p,"expires_at_ms"),max)
    }
    fun verify(envelope: String, policy: LabPolicy, binding: LabDeviceBinding, now: Long): VerifiedLabJob {
        require(envelope.toByteArray(Charsets.UTF_8).size <= 16384) { "LAB_ENVELOPE_TOO_LARGE" }
        require(now >= policy.notBefore && now < policy.expiresAt) { "LAB_AUTHORITY_EXPIRED" }
        val outer = JSONObject(envelope); keys(outer,setOf("body_base64","signature_base64"))
        val body = Base64.getDecoder().decode(outer.getString("body_base64"))
        val signature = Base64.getDecoder().decode(outer.getString("signature_base64"))
        require(Signature.getInstance("SHA256withECDSA").run { initVerify(policy.publicKey); update(body); verify(signature) }) { "LAB_SIGNATURE_REJECTED" }
        val job = JSONObject(String(body,Charsets.UTF_8))
        keys(job,setOf("version","purpose","job_id","reason","issued_at_ms","expires_at_ms","binding","profile","kind"))
        require(job.getString("version") == "1.0.0" && job.getString("purpose") == "HARDWARE_PHYSICAL_LAB") { "LAB_PURPOSE_REJECTED" }
        val issued=integer(job,"issued_at_ms"); val expires=integer(job,"expires_at_ms")
        require(issued >= 0 && issued <= now && now < expires && expires <= policy.expiresAt && expires > issued && expires-issued <= policy.maxJobSeconds*1000) { "LAB_JOB_EXPIRED_OR_FUTURE" }
        val b=job.getJSONObject("binding")
        keys(b,setOf("installation","key_fingerprint","report_nonce","usb_name","descriptor_sha256","vendor","product","interface_index","endpoint"))
        require(integer(b,"vendor") in 1..65535 && integer(b,"product") in 0..65535 && integer(b,"interface_index") in 0..255 && integer(b,"endpoint") in 1..255) { "LAB_USB_SELECTOR_REJECTED" }
        require(LabDeviceBinding(text(b,"installation"),text(b,"key_fingerprint"),text(b,"report_nonce"),text(b,"usb_name"),text(b,"descriptor_sha256"),integer(b,"vendor").toInt(),integer(b,"product").toInt(),integer(b,"interface_index").toInt(),integer(b,"endpoint").toInt()) == binding) { "LAB_DEVICE_BINDING_REJECTED" }
        require(binding.vendor in 1..65535 && binding.product in 0..65535 && binding.interfaceIndex in 0..255 && binding.endpoint in 1..255)
        val p=job.getJSONObject("profile")
        keys(p,setOf("printer_model","printer_firmware","protocol","identity_evidence","command_evidence","timeout_ms","drawer"))
        require(text(p,"printer_model") == "GP-L80160" && text(p,"protocol") == "ESC_POS") { "LAB_MODEL_REJECTED" }
        val firmware=text(p,"printer_firmware"); val identity=text(p,"identity_evidence"); val command=text(p,"command_evidence")
        val timeout=integer(p,"timeout_ms"); require(timeout in 100..30000)
        val kind=text(job,"kind"); val reason=text(job,"reason"); require(reason.length in 3..200)
        val jobId=text(job,"job_id"); java.util.UUID.fromString(jobId)
        var electrical="Sin pulso ni corte."
        val bytes=when(kind) {
            "PRINT_TEST" -> { require(p.isNull("drawer")); "CAMACHO POS - LABORATORIO\nNo es una venta ni documento fiscal\nGP-L80160 USB / ASCII\nTrabajo: $jobId\n\n\n".toByteArray(Charsets.US_ASCII) }
            "DRAWER_OPEN" -> {
                val d=p.getJSONObject("drawer")
                keys(d,setOf("model","pin","on_byte","off_byte","time_unit_ms","voltage_v","electrical_evidence"))
                require(text(d,"model") == "CD350") { "LAB_DRAWER_MODEL_REJECTED" }
                val pin=integer(d,"pin"); val on=integer(d,"on_byte"); val off=integer(d,"off_byte");val unit=integer(d,"time_unit_ms")
                require(pin in 0..1 && on in 1..255 && off in 1..255 && unit in 1..1000)
                val voltage=text(d,"voltage_v");require(voltage.matches(Regex("[0-9]+(?:\\.[0-9]+)?")) && voltage.toDouble() > 0)
                electrical="CD350: pin=$pin, on=$on x $unit ms, off=$off x $unit ms, $voltage V. ${text(d,"electrical_evidence")}"
                byteArrayOf(27,112,pin.toByte(),on.toByte(),off.toByte())
            }
            else -> error("LAB_KIND_REJECTED")
        }
        val intent=HardwareIntent(jobId,sha256(body),if(kind=="PRINT_TEST") JobKind.PRINT else JobKind.DRAWER_OPEN,reason)
        return VerifiedLabJob(intent,UsbSelection(binding.usbName,binding.vendor,binding.product,binding.interfaceIndex,binding.endpoint,binding.descriptorSha256,timeout.toInt()),bytes,
            "$kind\n$jobId\nMotivo: $reason\nGP-L80160 firmware: $firmware\nUSB ${binding.vendor}:${binding.product}, interfaz ${binding.interfaceIndex}, endpoint ${binding.endpoint}\n$identity\n$command\n$electrical\nNo confirma resultado físico.",expires)
    }
}

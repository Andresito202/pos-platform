package co.camachopos.hardware.lab

import android.app.Activity
import android.app.AlertDialog
import android.app.PendingIntent
import android.content.Intent
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Build
import android.os.Bundle
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import co.camachopos.hardware.*
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.Base64
import java.util.UUID
import java.util.concurrent.Executors
import org.json.JSONArray
import org.json.JSONObject

/** Native laboratory surface. Exported launcher ignores every external Intent extra/URI. */
class LabActivity : Activity() {
    private lateinit var output: TextView
    private lateinit var manager: UsbManager
    private lateinit var ledger: SqliteHardwareLedger
    private lateinit var policy: LabPolicy
    @Volatile private var reportNonce=UUID.randomUUID().toString()
    private var pending: VerifiedLabJob?=null
    private var envelope: String?=null
    private var exportText=""
    private val worker=Executors.newSingleThreadExecutor()
    private val alias="camacho-hardware-lab-device-v1"
    private val prefs by lazy { getSharedPreferences("hardware-lab",MODE_PRIVATE) }
    private val installation by lazy { prefs.getString("installation",null) ?: UUID.randomUUID().toString().also { check(prefs.edit().putString("installation",it).commit()) } }
    private val keyStore by lazy { KeyStore.getInstance("AndroidKeyStore").apply { load(null) } }
    private fun deviceKey(): ByteArray {
        if(!keyStore.containsAlias(alias)) {
            val generator=KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC,"AndroidKeyStore")
            generator.initialize(KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
                .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1")).setDigests(KeyProperties.DIGEST_SHA256).build())
            generator.generateKeyPair()
        }
        return keyStore.getCertificate(alias).publicKey.encoded
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        val layout=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL;setPadding(20,20,20,20) }
        val scroll=ScrollView(this).apply { addView(layout) };setContentView(scroll)
        layout.addView(TextView(this).apply { text="CAMACHO HARDWARE · LABORATORIO\nNo es POS comercial. Sin login, ventas ni red.\nNo se envía nada al abrir o conectar USB.";textSize=18f })
        output=TextView(this).apply { textSize=13f;setTextIsSelectable(true) }
        fun button(label:String, action:()->Unit) { layout.addView(Button(this).apply { text=label;filterTouchesWhenObscured=true;setOnClickListener { try { action() } catch(e:Exception) { showError(e) } } }) }
        button("1. Descubrir USB y terminal") { pending=null;envelope=null;reportNonce=UUID.randomUUID().toString();showInventory() }
        button("2. Solicitar permiso USB (sin imprimir)") { requestUsbPermission() }
        button("3. Exportar informe firmado") { exportText=signedReport();createDocument("camacho-hardware-report.json") }
        button("4. Importar orden de laboratorio firmada") {
            startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).apply { type="application/json";addCategory(Intent.CATEGORY_OPENABLE) },100)
        }
        button("5. Revisar y ejecutar UNA orden") { reviewAndExecute() }
        button("Exportar registro de ejecución") { exportText=signedEvidence();createDocument("camacho-hardware-evidence.json") }
        button("Desarmar órdenes de esta autoridad LAB") {
            AlertDialog.Builder(this).setTitle("Desarmar pruebas físicas").setMessage("Bloquea las órdenes de esta autoridad en esta instalación. Conserva registro y permite descubrir/exportar. No modifica sesiones comerciales.")
                .setNegativeButton("Cancelar",null).setPositiveButton("Desarmar") { _,_ ->
                    check(prefs.edit().putBoolean("revoked_"+LabAuthorization.sha256(policy.publicKey.encoded),true).commit())
                    pending=null;envelope=null;output.text="AUTORIDAD LAB DESARMADA. No se admiten nuevos envíos."
                }.show()
        }
        layout.addView(output)
        try {
            check(Build.VERSION.SDK_INT >= 28)
            manager=getSystemService(USB_SERVICE) as UsbManager
            policy=LabAuthorization.policy(assets.open("lab-policy.json").bufferedReader().use { it.readText() })
            ledger=SqliteHardwareLedger(applicationContext);ledger.recoverInterrupted();deviceKey();showInventory()
        } catch(e:Exception) { showError(e) }
    }
    @Synchronized private fun now():Long {
        val current=System.currentTimeMillis();val prior=prefs.getLong("last_clock",0)
        check(current>=prior) { "LAB_CLOCK_ROLLBACK_REJECTED" }
        check(prefs.edit().putLong("last_clock",current).commit());return current
    }
    private fun descriptors(device:UsbDevice):String? {
        if(!manager.hasPermission(device))return null
        return manager.openDevice(device)?.let { connection -> try { LabAuthorization.sha256(connection.rawDescriptors) } finally { connection.close() } }
    }
    private fun inventory():JSONObject {
        val devices=JSONArray()
        manager.deviceList.values.forEach { device ->
            val endpoints=JSONArray()
            for(index in 0 until device.interfaceCount) {
                val face=device.getInterface(index)
                for(e in 0 until face.endpointCount) { val ep=face.getEndpoint(e)
                    endpoints.put(JSONObject().put("interface_index",index).put("interface_id",face.id).put("address",ep.address).put("direction",ep.direction).put("type",ep.type).put("bulk_out",ep.direction==UsbConstants.USB_DIR_OUT&&ep.type==UsbConstants.USB_ENDPOINT_XFER_BULK))
                }
            }
            devices.put(JSONObject().put("usb_name",device.deviceName).put("vendor",device.vendorId).put("product",device.productId)
                .put("manufacturer",device.manufacturerName?:JSONObject.NULL).put("model",device.productName?:JSONObject.NULL)
                .put("usb_version",device.version).put("permission",manager.hasPermission(device))
                .put("descriptor_sha256",descriptors(device)?:JSONObject.NULL).put("endpoints",endpoints))
        }
        return JSONObject().put("version","1.0.0").put("purpose","HARDWARE_PHYSICAL_LAB_REPORT").put("installation",installation)
            .put("key_fingerprint",LabAuthorization.sha256(deviceKey())).put("report_nonce",reportNonce).put("observed_at_ms",now())
            .put("android",Build.VERSION.RELEASE).put("sdk",Build.VERSION.SDK_INT).put("manufacturer",Build.MANUFACTURER)
            .put("model",Build.MODEL).put("build",Build.DISPLAY).put("abis",JSONArray(Build.SUPPORTED_ABIS.toList()))
            .put("app_authority_sha256",LabAuthorization.sha256(policy.publicKey.encoded)).put("authority_expires_at_ms",policy.expiresAt)
            .put("devices",devices).put("physical_print_observed",false).put("physical_drawer_observed",false)
    }
    private fun signBody(body:JSONObject):String {
        val bytes=body.toString().toByteArray(Charsets.UTF_8)
        val signature=Signature.getInstance("SHA256withECDSA").run { initSign(keyStore.getKey(alias,null) as java.security.PrivateKey);update(bytes);sign() }
        return JSONObject().put("body_base64",Base64.getEncoder().encodeToString(bytes)).put("signature_base64",Base64.getEncoder().encodeToString(signature))
            .put("device_public_key_spki",Base64.getEncoder().encodeToString(deviceKey())).toString(2)
    }
    private fun signedReport():String=signBody(inventory())
    private fun signedEvidence():String {
        val events=JSONArray()
        ledger.readableDatabase.rawQuery("SELECT id,checksum,kind,state FROM hardware_jobs ORDER BY rowid",null).use { cursor ->
            while(cursor.moveToNext())events.put(JSONObject().put("job_id",cursor.getString(0)).put("checksum",cursor.getString(1)).put("kind",cursor.getString(2)).put("state",cursor.getString(3)))
        }
        val authorizations=JSONArray()
        java.io.File(filesDir,"hardware-lab-orders").listFiles()?.filter { it.extension=="json" }?.forEach { file ->
            authorizations.put(JSONObject(file.readText(Charsets.UTF_8)))
        }
        return signBody(JSONObject().put("purpose","HARDWARE_PHYSICAL_LAB_EVIDENCE").put("installation",installation).put("at_ms",now()).put("authorizations",authorizations)
            .put("events",events).put("physical_result","REQUIRES_OPERATOR_OBSERVATION"))
    }
    private fun showInventory() { output.text=inventory().toString(2)+"\nPermiso USB ≠ modelo certificado. No hay sensor físico validado." }
    private fun requestUsbPermission() {
        val devices=manager.deviceList.values.toList();check(devices.isNotEmpty()) { "USB_DEVICE_NOT_PRESENT" }
        AlertDialog.Builder(this).setTitle("Seleccionar dispositivo: no se envían bytes").setItems(devices.map { "${it.deviceName} VID=${it.vendorId} PID=${it.productId} ${it.productName}" }.toTypedArray()) { _,index ->
            val device=devices[index]
            val intent=Intent(packageName+".USB_PERMISSION").setPackage(packageName)
            manager.requestPermission(device,PendingIntent.getBroadcast(this,0,intent,PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            output.text="Responde al permiso Android. Después descubre USB y exporta de nuevo el informe."
        }.setNegativeButton("Cancelar",null).show()
    }
    private fun bindingFor(raw:String):LabDeviceBinding {
        // Parse only a selector; authority and every field are verified before any effect.
        val body=JSONObject(String(Base64.getDecoder().decode(JSONObject(raw).getString("body_base64")),Charsets.UTF_8))
        val name=body.getJSONObject("binding").getString("usb_name")
        val device=manager.deviceList[name] ?: error("USB_DEVICE_NOT_PRESENT")
        check(manager.hasPermission(device)) { "USB_PERMISSION_REQUIRED" }
        val target=body.getJSONObject("binding");val index=target.getInt("interface_index");val endpoint=target.getInt("endpoint")
        check(index in 0 until device.interfaceCount)
        val face=device.getInterface(index)
        check((0 until face.endpointCount).any { face.getEndpoint(it).let { ep -> ep.address==endpoint&&ep.direction==UsbConstants.USB_DIR_OUT&&ep.type==UsbConstants.USB_ENDPOINT_XFER_BULK } }) { "USB_ENDPOINT_REJECTED" }
        return LabDeviceBinding(installation,LabAuthorization.sha256(deviceKey()),reportNonce,name,descriptors(device)?:error("USB_DESCRIPTOR_UNAVAILABLE"),device.vendorId,device.productId,index,endpoint)
    }
    private fun validate(raw:String):VerifiedLabJob {
        check(!prefs.getBoolean("revoked_"+LabAuthorization.sha256(policy.publicKey.encoded),false)) { "LAB_AUTHORITY_REVOKED" }
        return LabAuthorization.verify(raw,policy,bindingFor(raw),now())
    }
    private fun reviewAndExecute() {
        val raw=envelope?:error("IMPORT_SIGNED_JOB_FIRST");val verified=validate(raw)
        check(ledger.state(verified.intent.jobId)==null) { "LAB_REPLAY_REJECTED" }
        AlertDialog.Builder(this).setTitle("Verifica etiqueta, cableado y parámetros").setMessage(verified.summary+"\n\nConfirma solo si coinciden físicamente. No reenvíes si el resultado es incierto.")
            .setNegativeButton("Cancelar",null).setPositiveButton("Confirmo UNA ejecución") { _,_ ->
                envelope=null;pending=null
                worker.execute {
                    try {
                        val checked=validate(raw);val p=checked.usb
                        // Preserve signed authorization before any transport I/O. No business data.
                        val directory=java.io.File(filesDir,"hardware-lab-orders").apply { check(isDirectory||mkdirs()) }
                        val record=java.io.File(directory,checked.intent.jobId+".json")
                        if(record.exists())check(record.readText(Charsets.UTF_8)==raw) { "LAB_AUDIT_CONFLICT" }
                        else java.io.FileOutputStream(record).use { stream -> stream.write(raw.toByteArray(Charsets.UTF_8));stream.fd.sync() }
                        val transport=UsbHostTransport(applicationContext,UsbPrinterProfile(p.vendor,p.product,p.interfaceIndex,p.endpoint,p.timeoutMs,p.name,p.descriptorSha256))
                        val bridge=AuthorizedHardwareBridge({ intent ->
                            val current=validate(raw);if(current.intent==intent) AuthorizedJob(intent,current.bytes) else null
                        },ledger,transport)
                        val state=bridge.execute(checked.intent)
                        runOnUiThread { output.text="${checked.summary}\nESTADO TRANSPORTE: $state\nComprueba papel/cajón tú mismo. No hay sensor confirmado. Exporta el registro." }
                    } catch(e:Exception) { runOnUiThread { showError(e) } }
                }
            }.show().window?.decorView?.filterTouchesWhenObscured=true
    }
    private fun createDocument(name:String) {
        startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).apply { addCategory(Intent.CATEGORY_OPENABLE);type="application/json";putExtra(Intent.EXTRA_TITLE,name) },101)
    }
    override fun onActivityResult(requestCode:Int,resultCode:Int,data:Intent?) {
        super.onActivityResult(requestCode,resultCode,data)
        if(resultCode!=RESULT_OK)return
        try {
            val uri=data?.data?:error("DOCUMENT_REQUIRED")
            if(requestCode==100) {
                val bytes=contentResolver.openInputStream(uri)!!.use { stream -> val buffer=ByteArray(16385);var total=0;while(total<buffer.size) { val count=stream.read(buffer,total,buffer.size-total);if(count<0)break;total+=count };check(total<=16384);buffer.copyOf(total) }
                val raw=String(bytes,Charsets.UTF_8);val checked=validate(raw)
                check(ledger.state(checked.intent.jobId)==null) { "LAB_REPLAY_REJECTED" }
                envelope=raw;pending=checked;output.text="ORDEN VERIFICADA; SIN EJECUTAR\n"+checked.summary
            } else if(requestCode==101)contentResolver.openOutputStream(uri,"wt")!!.use { it.write(exportText.toByteArray(Charsets.UTF_8)) }
        } catch(e:Exception) { envelope=null;pending=null;showError(e) }
    }
    private fun showError(error:Exception) { output.text="BLOQUEADO: ${error.message}\nNo reintentar una orden física incierta. No se declara éxito físico." }
    override fun onDestroy() { worker.shutdown();super.onDestroy() }
}

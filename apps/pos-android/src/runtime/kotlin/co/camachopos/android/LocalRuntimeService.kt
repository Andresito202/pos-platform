package co.camachopos.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Binder
import android.os.IBinder
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.os.Process as AndroidProcess
import android.util.AtomicFile
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONObject

/** Unexported same-UID host. No commercial command or provisioned identity is accepted here. */
class LocalRuntimeService:Service() {
    private val worker=Executors.newSingleThreadExecutor()
    private val started=AtomicBoolean(false)
    private val stopping=AtomicBoolean(false)
    @Volatile private var custodyHardware:Boolean?=null
    @Volatile private var child:java.lang.Process?=null
    private val main=Handler(Looper.getMainLooper())
    private val licenseQuery=AndroidLicenseQuery({SystemClock.elapsedRealtime()})
    private val pipeLock=Any()
    @Volatile private var status="{\"state\":\"STARTING\",\"commercial_access\":\"BLOCKED_PENDING_TRUSTED_PROVISIONING\"}"
    inner class LocalBinder:Binder() {
        fun status():String { check(Binder.getCallingUid()==AndroidProcess.myUid());return status }
        /** Only the inherited service pipe supplies the informational result. */
        fun queryLicenseInformation(callback:(OperationalLicenseInformation)->Unit) {
            check(Binder.getCallingUid()==AndroidProcess.myUid())
            val process=child
            if(process==null||stopping.get()||JSONObject(status).optString("state")!="READY"){callback(OperationalLicenseInformation.unverified());return}
            val id=licenseQuery.begin { value->main.post {callback(value)} }?:return
            try { synchronized(pipeLock){process.outputStream.write("LICENSE_INFORMATION $id\n".toByteArray(Charsets.US_ASCII));process.outputStream.flush()} }
            catch(_:Exception){licenseQuery.cancel()}
            main.postDelayed({licenseQuery.expire()},2000)
        }
        fun stop() { check(Binder.getCallingUid()==AndroidProcess.myUid());requestStop() }
        fun takeBusinessAuthorizationCode():AndroidPendingBusinessAuthorization.Exchange? {
            check(Binder.getCallingUid()==AndroidProcess.myUid())
            return AndroidBusinessAuthorizationHost.takeForNativeExchange()
        }
        fun cancelBusinessAuthorization() {
            check(Binder.getCallingUid()==AndroidProcess.myUid());AndroidBusinessAuthorizationHost.cancel()
        }
    }
    override fun onBind(intent:Intent?):IBinder=LocalBinder()
    override fun onCreate() {
        super.onCreate()
        val manager=getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(NotificationChannel("canonical-runtime","Servicio local Camacho",NotificationManager.IMPORTANCE_LOW))
        startForeground(24,Notification.Builder(this,"canonical-runtime").setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("Camacho: servicio local sin aprovisionar").setContentText("Sin acceso comercial. No controla hardware.").setOngoing(true).build())
    }
    override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int {
        if(intent?.action=="co.camachopos.android.STOP")requestStop()
        else if(started.compareAndSet(false,true))worker.execute { runChild() }
        return START_NOT_STICKY
    }
    private fun publish(value:String) {
        val result=JSONObject(value)
        check(result.getString("commercial_access")=="BLOCKED_PENDING_TRUSTED_PROVISIONING")
        check(result.getString("state") in listOf("STARTING","READY","STOPPED","FAILED"))
        custodyHardware?.let { result.put("keystore_hardware_backed",it) }
        status=result.toString()
        val file=AtomicFile(File(filesDir,"android-service-status.json"))
        val stream=file.startWrite()
        try { stream.write(status.toByteArray(Charsets.UTF_8));file.finishWrite(stream) }
        catch(error:Exception){file.failWrite(stream);throw error}
    }
    private fun runChild() {
        var process:java.lang.Process?=null
        try {
            publish(status)
            val root=RuntimeAssets.materialize(this)
            val directory=File(filesDir,"android-local-service").apply { check(isDirectory||mkdirs()) }
            val builder=ProcessBuilder(RuntimeAssets.executable(this,root).path,File(root,"runtime-service.mjs").path).directory(root)
                .redirectError(File(filesDir,"android-service-error.log"))
            builder.environment().apply {
                remove("NODE_OPTIONS");remove("NODE_PATH")
                put("LD_LIBRARY_PATH",RuntimeAssets.libraries(this@LocalRuntimeService,root).path);put("HOME",filesDir.path);put("TMPDIR",cacheDir.path)
                put("CAMACHO_ANDROID_NATIVE_LIBRARY_DIRECTORY",applicationInfo.nativeLibraryDir)
                put("CAMACHO_ANDROID_SERVICE_DIRECTORY",directory.path)
            }
            val material=AndroidRootCustody.load(this)
            custodyHardware=material.hardwareBacked
            try {
                process=builder.start()
                // Root seed travels only through this inherited private pipe, never env/argv/files/logs.
                process.outputStream.write(material.root);process.outputStream.flush()
            } finally { material.root.fill(0) }
            val active=process ?: error("RUNTIME_PROCESS_MISSING")
            child=active
            if(stopping.get())sendStop(active)
            active.inputStream.bufferedReader().useLines { lines -> lines.forEach { line ->
                check(line.length<=4096) { "RUNTIME_STATUS_SIZE_REJECTED" }
                val result=JSONObject(line)
                if(result.optString("kind")=="LICENSE_INFORMATION") {
                    val info=result.getJSONObject("information")
                    val state=info.getString("status")
                    check(state in listOf("UNVERIFIED","CURRENT","EXPIRED","SUSPENDED","REVOKED"))
                    fun nullable(name:String):String?=if(info.isNull(name))null else info.getString(name).also {check(it.length<=64)}
                    check(licenseQuery.complete(result.getInt("request"),OperationalLicenseInformation(state,nullable("signedValidUntil"),nullable("lastAcceptedLocalCheck")))) {"LICENSE_RESPONSE_CORRELATION_REJECTED"}
                    publish(JSONObject(status).put("license_information_request",result.getInt("request")).put("license_information",info).toString())
                } else publish(line)
            } }
            check(active.waitFor()==0&&JSONObject(status).getString("state")=="STOPPED") { "RUNTIME_PROCESS_FAILED" }
        } catch(error:Exception) {
            publish("{\"state\":\"FAILED\",\"commercial_access\":\"BLOCKED_PENDING_TRUSTED_PROVISIONING\"}")
        } finally {
            licenseQuery.cancel();process?.destroy();child=null;stopForeground(true);stopSelf()
        }
    }
    private fun sendStop(process:java.lang.Process) {
        try { synchronized(pipeLock){process.outputStream.write("STOP\n".toByteArray(Charsets.US_ASCII));process.outputStream.flush()} } catch(_:Exception) { process.destroy() }
        Thread { if(!process.waitFor(10,TimeUnit.SECONDS))process.destroyForcibly() }.apply { isDaemon=true;start() }
    }
    private fun requestStop() {
        licenseQuery.cancel()
        AndroidBusinessAuthorizationHost.cancel()
        if(stopping.compareAndSet(false,true))child?.let { sendStop(it) }
        if(!started.get())stopSelf()
    }
    override fun onDestroy() { requestStop();worker.shutdown();super.onDestroy() }
}

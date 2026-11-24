package co.camachopos.colombia.runtime

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Binder
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.util.AtomicFile
import android.os.Process as AndroidProcess
import co.camachopos.colombia.auth.AndroidBusinessAuthorizationHost
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import org.json.JSONObject

/**
 * Unexported same-UID commercial host. Starts the embedded Node/SQLite engine
 * and forwards REQUEST lines to Local Service contracts. No mock responses.
 */
class LocalPosService : Service() {
    private val worker = Executors.newSingleThreadExecutor()
    private val started = AtomicBoolean(false)
    private val stopping = AtomicBoolean(false)
    @Volatile private var custodyHardware: Boolean? = null
    @Volatile private var child: java.lang.Process? = null
    private val main = Handler(Looper.getMainLooper())
    private val licenseQuery = AndroidLicenseQuery({ SystemClock.elapsedRealtime() })
    private val requestSeq = AtomicInteger(0)
    private val pendingRequests = ConcurrentHashMap<Int, (JSONObject) -> Unit>()
    private val pipeLock = Any()
    @Volatile private var status =
        """{"state":"STARTING","commercial_access":"BLOCKED_PENDING_TRUSTED_PROVISIONING","local_security":"NOT_PROVISIONED","external_channel":"CLOSED","engine":"EMBEDDED_NODE_SQLITE"}"""

    inner class LocalBinder : Binder() {
        fun status(): String {
            check(Binder.getCallingUid() == AndroidProcess.myUid())
            return status
        }

        fun queryLicenseInformation(callback: (OperationalLicenseInformation) -> Unit) {
            check(Binder.getCallingUid() == AndroidProcess.myUid())
            val process = child
            if (process == null || stopping.get() || JSONObject(status).optString("state") != "READY") {
                callback(OperationalLicenseInformation.unverified())
                return
            }
            val id = licenseQuery.begin { value -> main.post { callback(value) } } ?: return
            try {
                synchronized(pipeLock) {
                    process.outputStream.write("LICENSE_INFORMATION $id\n".toByteArray(Charsets.US_ASCII))
                    process.outputStream.flush()
                }
            } catch (_: Exception) {
                licenseQuery.cancel()
            }
            main.postDelayed({ licenseQuery.expire() }, 2000)
        }

        fun request(payload: JSONObject, callback: (JSONObject) -> Unit) {
            check(Binder.getCallingUid() == AndroidProcess.myUid())
            val process = child
            if (process == null || stopping.get() || JSONObject(status).optString("state") != "READY") {
                callback(
                    JSONObject()
                        .put("status", "FAILED")
                        .put("result_code", "SERVICE_UNAVAILABLE")
                        .put(
                            "error",
                            JSONObject()
                                .put("code", "SERVICE_UNAVAILABLE")
                                .put("user_message", "El servicio local no está listo."),
                        ),
                )
                return
            }
            val id = requestSeq.incrementAndGet()
            pendingRequests[id] = callback
            try {
                synchronized(pipeLock) {
                    val line = "REQUEST $id ${payload.toString()}\n"
                    check(line.length <= 65000) { "REQUEST_TOO_LARGE" }
                    process.outputStream.write(line.toByteArray(Charsets.US_ASCII))
                    process.outputStream.flush()
                }
                main.postDelayed({
                    pendingRequests.remove(id)?.invoke(
                        JSONObject()
                            .put("status", "FAILED")
                            .put("result_code", "TIMEOUT")
                            .put(
                                "error",
                                JSONObject()
                                    .put("code", "TIMEOUT")
                                    .put("user_message", "La operación tardó demasiado."),
                            ),
                    )
                }, 15000)
            } catch (_: Exception) {
                pendingRequests.remove(id)
                callback(
                    JSONObject()
                        .put("status", "FAILED")
                        .put("result_code", "PIPE_ERROR")
                        .put(
                            "error",
                            JSONObject()
                                .put("code", "PIPE_ERROR")
                                .put("user_message", "No se pudo comunicar con el servicio local."),
                        ),
                )
            }
        }

        fun takeBusinessAuthorizationCode(): co.camachopos.colombia.auth.AndroidPendingBusinessAuthorization.Exchange? {
            check(Binder.getCallingUid() == AndroidProcess.myUid())
            return AndroidBusinessAuthorizationHost.takeForNativeExchange()
        }

        fun depositBusinessExchange(
            exchange: co.camachopos.colombia.auth.AndroidPendingBusinessAuthorization.Exchange,
        ) {
            check(Binder.getCallingUid() == AndroidProcess.myUid())
            pendingExchange = exchange
        }

        fun businessClientId(): String {
            check(Binder.getCallingUid() == AndroidProcess.myUid())
            return JSONObject(status).optString("business_client_id", "android-commercial")
        }

        fun registerNativeBusinessRequest(
            material: JSONObject,
            callback: (JSONObject) -> Unit,
        ) {
            check(Binder.getCallingUid() == AndroidProcess.myUid())
            request(
                JSONObject()
                    .put("protocol_version", "1.0.0")
                    .put("message_type", "android.business.native_request")
                    .put("request_id", java.util.UUID.randomUUID().toString())
                    .put("correlation_id", JSONObject.NULL)
                    .put("payload", material),
                callback,
            )
        }

        fun completeBusinessTokenExchange(callback: (JSONObject) -> Unit) {
            check(Binder.getCallingUid() == AndroidProcess.myUid())
            val exchange = pendingExchange
            if (exchange == null) {
                callback(
                    JSONObject()
                        .put("status", "FAILED")
                        .put("result_code", "BUSINESS_EXCHANGE_MISSING")
                        .put(
                            "error",
                            JSONObject()
                                .put("code", "BUSINESS_EXCHANGE_MISSING")
                                .put("user_message", "No hay código BUSINESS pendiente de canje."),
                        ),
                )
                return
            }
            request(
                JSONObject()
                    .put("protocol_version", "1.0.0")
                    .put("message_type", "android.business.token_exchange")
                    .put("request_id", java.util.UUID.randomUUID().toString())
                    .put("correlation_id", JSONObject.NULL)
                    .put(
                        "payload",
                        JSONObject()
                            .put("code", exchange.code)
                            .put("code_verifier", exchange.verifier)
                            .put("state", exchange.state)
                            .put("client_id", exchange.clientId)
                            .put("redirect_uri", exchange.redirectUri),
                    ),
                callback,
            )
        }

        fun stop() {
            check(Binder.getCallingUid() == AndroidProcess.myUid())
            requestStop()
        }
    }

    @Volatile
    private var pendingExchange: co.camachopos.colombia.auth.AndroidPendingBusinessAuthorization.Exchange? = null

    override fun onBind(intent: Intent?): IBinder = LocalBinder()

    override fun onCreate() {
        super.onCreate()
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(
            NotificationChannel("camacho-local-pos", "Camacho POS Colombia", NotificationManager.IMPORTANCE_LOW),
        )
        startForeground(
            28,
            Notification.Builder(this, "camacho-local-pos")
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .setContentTitle("Camacho POS Colombia")
                .setContentText("Servicio local en ejecución")
                .setOngoing(true)
                .build(),
        )
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) requestStop()
        else if (started.compareAndSet(false, true)) worker.execute { runHost() }
        return START_NOT_STICKY
    }

    private fun publish(value: String) {
        val result = JSONObject(value)
        check(result.getString("state") in listOf("STARTING", "READY", "STOPPED", "FAILED"))
        custodyHardware?.let { result.put("keystore_hardware_backed", it) }
        status = result.toString()
        val file = AtomicFile(File(filesDir, "android-service-status.json"))
        val stream = file.startWrite()
        try {
            stream.write(status.toByteArray(Charsets.UTF_8))
            file.finishWrite(stream)
        } catch (error: Exception) {
            file.failWrite(stream)
            throw error
        }
    }

    private fun runHost() {
        var process: java.lang.Process? = null
        try {
            publish(status)
            val root = RuntimeAssets.materialize(this)
            val directory = File(filesDir, "android-local-service").apply { check(isDirectory || mkdirs()) }
            val builder = ProcessBuilder(
                RuntimeAssets.executable(this, root).path,
                File(root, "runtime-service.mjs").path,
            ).directory(root).redirectError(File(filesDir, "android-service-error.log"))
            builder.environment().apply {
                remove("NODE_OPTIONS")
                remove("NODE_PATH")
                put("LD_LIBRARY_PATH", RuntimeAssets.libraries(this@LocalPosService, root).path)
                put("HOME", filesDir.path)
                put("TMPDIR", cacheDir.path)
                put("CAMACHO_ANDROID_NATIVE_LIBRARY_DIRECTORY", applicationInfo.nativeLibraryDir)
                put("CAMACHO_ANDROID_SERVICE_DIRECTORY", directory.path)
            }
            val material = AndroidRootCustody.load(this)
            custodyHardware = material.hardwareBacked
            try {
                process = builder.start()
                process.outputStream.write(material.root)
                process.outputStream.flush()
            } finally {
                material.root.fill(0)
            }
            val active = process ?: error("RUNTIME_PROCESS_MISSING")
            child = active
            if (stopping.get()) sendStop(active)
            active.inputStream.bufferedReader().useLines { lines ->
                lines.forEach { line ->
                    check(line.length <= 65536) { "RUNTIME_STATUS_SIZE_REJECTED" }
                    val result = JSONObject(line)
                    when (result.optString("kind")) {
                        "LICENSE_INFORMATION" -> {
                            val info = result.getJSONObject("information")
                            val state = info.getString("status")
                            check(state in listOf("UNVERIFIED", "CURRENT", "EXPIRED", "SUSPENDED", "REVOKED"))
                            fun nullable(name: String): String? =
                                if (info.isNull(name)) null else info.getString(name).also { check(it.length <= 64) }
                            check(
                                licenseQuery.complete(
                                    result.getInt("request"),
                                    OperationalLicenseInformation(
                                        state,
                                        nullable("signedValidUntil"),
                                        nullable("lastAcceptedLocalCheck"),
                                    ),
                                ),
                            ) { "LICENSE_RESPONSE_CORRELATION_REJECTED" }
                        }
                        "REQUEST_RESULT" -> {
                            val id = result.getInt("request")
                            val payload = result.getJSONObject("result")
                            main.post { pendingRequests.remove(id)?.invoke(payload) }
                        }
                        else -> publish(line)
                    }
                }
            }
            check(active.waitFor() == 0 && JSONObject(status).getString("state") == "STOPPED") {
                "RUNTIME_PROCESS_FAILED"
            }
        } catch (_: Exception) {
            publish(
                """{"state":"FAILED","commercial_access":"BLOCKED_PENDING_TRUSTED_PROVISIONING","local_security":"NOT_PROVISIONED","external_channel":"CLOSED","engine":"EMBEDDED_NODE_SQLITE"}""",
            )
        } finally {
            licenseQuery.cancel()
            pendingRequests.clear()
            process?.destroy()
            child = null
            stopForeground(true)
            stopSelf()
        }
    }

    private fun sendStop(process: java.lang.Process) {
        try {
            synchronized(pipeLock) {
                process.outputStream.write("STOP\n".toByteArray(Charsets.US_ASCII))
                process.outputStream.flush()
            }
        } catch (_: Exception) {
            process.destroy()
        }
        Thread {
            if (!process.waitFor(10, TimeUnit.SECONDS)) process.destroyForcibly()
        }.apply { isDaemon = true; start() }
    }

    private fun requestStop() {
        licenseQuery.cancel()
        AndroidBusinessAuthorizationHost.cancel()
        if (stopping.compareAndSet(false, true)) child?.let { sendStop(it) }
        if (!started.get()) stopSelf()
    }

    override fun onDestroy() {
        requestStop()
        worker.shutdown()
        super.onDestroy()
    }

    companion object {
        const val ACTION_STOP = "co.camachopos.colombia.STOP"
    }
}

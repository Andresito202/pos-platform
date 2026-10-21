package co.camachopos.android

import android.app.Activity
import android.os.Bundle
import android.util.Log
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.json.JSONObject

/** Runs the bundled Node executable and unchanged canonical LocalDatabase in this probe's sandbox. */
class RuntimeProbeActivity : Activity() {
    private lateinit var output:TextView
    private lateinit var button:Button
    private val executor=Executors.newSingleThreadExecutor()
    override fun onCreate(state:Bundle?) {
        super.onCreate(state)
        val layout=LinearLayout(this).apply { orientation=LinearLayout.VERTICAL;setPadding(24,24,24,24) }
        output=TextView(this).apply { textSize=15f;setTextIsSelectable(true);text="Prueba aislada Node/Bionic + better-sqlite3 13.0.3 + LocalDatabase canónico.\nNo es login comercial; no genera ventas ni controla hardware." }
        button=Button(this).apply { text="Ejecutar motor de persistencia canónico";filterTouchesWhenObscured=true;setOnClickListener { runProbe() } }
        layout.addView(button);layout.addView(output);setContentView(ScrollView(this).apply { addView(layout) })
    }
    private fun sha(file:File):String {
        val digest=MessageDigest.getInstance("SHA-256");file.inputStream().use { stream -> val buffer=ByteArray(65536);while(true){val count=stream.read(buffer);if(count<0)break;digest.update(buffer,0,count)} }
        return digest.digest().joinToString(""){"%02x".format(it)}
    }
    private fun materialize():File {
        val manifest=JSONObject(assets.open("runtime/files.json").bufferedReader().use { it.readText() })
        val version=manifest.getString("bundle_id");check(version.matches(Regex("[a-f0-9]{64}")))
        val root=File(filesDir,"runtime-"+version.take(16)).apply { check(isDirectory||mkdirs()) }
        val files=manifest.getJSONObject("files")
        files.keys().forEach { path ->
            val destination=File(root,path).canonicalFile
            check(destination.path.startsWith(root.canonicalPath+File.separator)) { "BUNDLED_RUNTIME_PATH_REJECTED" }
            if(!destination.exists()) {
                check(destination.parentFile!!.isDirectory||destination.parentFile!!.mkdirs())
                val partial=File(destination.parentFile,destination.name+".partial")
                assets.open("runtime/"+path).use { input -> java.io.FileOutputStream(partial).use { target -> input.copyTo(target);target.fd.sync() } }
                check(sha(partial)==files.getString(path)) { "BUNDLED_RUNTIME_COPY_MISMATCH" }
                check(partial.renameTo(destination)) { "BUNDLED_RUNTIME_COMMIT_FAILED" }
            }
            check(sha(destination)==files.getString(path)) { "BUNDLED_RUNTIME_DIGEST_MISMATCH" }
        }
        check(File(root,"bin/node").setExecutable(true,true)) { "NODE_EXECUTION_MODE_FAILED" }
        return root
    }
    private fun runProbe() {
        button.isEnabled=false;output.text="Ejecutando Node y motor real en almacenamiento privado…"
        executor.execute {
            try {
                val root=materialize();val directory=File(filesDir,"commercial-engine-probe").apply { check(isDirectory||mkdirs()) }
                val report=File(filesDir,"runtime-result.json");val stderrFile=File(filesDir,"runtime-error.log")
                val builder=ProcessBuilder(File(root,"bin/node").path,File(root,"runtime-probe.mjs").path).directory(root)
                    .redirectOutput(report).redirectError(stderrFile)
                builder.environment().apply {
                    remove("NODE_OPTIONS");remove("NODE_PATH")
                    put("LD_LIBRARY_PATH",File(root,"lib").path);put("HOME",filesDir.path);put("TMPDIR",cacheDir.path)
                    put("CAMACHO_RUNTIME_PROBE_DIRECTORY",directory.path)
                }
                val process=builder.start()
                if(!process.waitFor(90,TimeUnit.SECONDS)) { process.destroyForcibly();error("RUNTIME_PROBE_TIMEOUT") }
                check(process.exitValue()==0) { "NODE_EXIT_${process.exitValue()}: "+stderrFile.readText().take(3000) }
                val result=JSONObject(report.readText())
                check(result.getBoolean("passed")&&result.getString("integrity")=="ok"&&result.getString("sqliteJournal")=="wal"&&result.getJSONArray("migrations").length()==18) { "CANONICAL_ENGINE_RESULT_REJECTED" }
                Log.i("CamachoRuntimeProbe",result.toString())
                runOnUiThread { output.text="PASS: NODE + BETTER-SQLITE3 + CANONICAL MIGRATIONS 1–18\nWRITE / READ / ROLLBACK / CLOSE / REOPEN\nProceso anterior validado: ${result.getBoolean("previousSuccessfulProcess")}\n\n$result\n\nNO LOGIN COMERCIAL. NO VENTA. NO HARDWARE." }
            }catch(failure:Exception) {
                Log.e("CamachoRuntimeProbe","FAILED",failure)
                runOnUiThread { output.text="FAILED: ${failure.message}\nNo se cambia de motor ni se relajan restricciones." }
            }finally{runOnUiThread { button.isEnabled=true }}
        }
    }
    override fun onDestroy() { executor.shutdown();super.onDestroy() }
}

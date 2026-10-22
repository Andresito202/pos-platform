package co.camachopos.android

import android.app.Activity
import android.os.Bundle
import android.content.Intent
import android.util.Log
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.io.File
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
        layout.addView(button)
        fun control(label:String,action:()->Unit) { layout.addView(Button(this).apply { text=label;filterTouchesWhenObscured=true;setOnClickListener { action() } }) }
        control("Iniciar servicio local sin aprovisionar") { startForegroundService(Intent(this,LocalRuntimeService::class.java));output.text="Iniciando servicio local. Acceso comercial bloqueado." }
        control("Estado del servicio local") { val file=File(filesDir,"android-service-status.json");output.text=if(file.isFile)file.readText() else "Servicio no iniciado" }
        control("Detener servicio local") { startService(Intent(this,LocalRuntimeService::class.java).setAction("co.camachopos.android.STOP")) }
        layout.addView(output);setContentView(ScrollView(this).apply { addView(layout) })
    }
    private fun runProbe() {
        button.isEnabled=false;output.text="Ejecutando Node y motor real en almacenamiento privado…"
        executor.execute {
            try {
                val root=RuntimeAssets.materialize(this);val directory=File(filesDir,"commercial-engine-probe").apply { check(isDirectory||mkdirs()) }
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

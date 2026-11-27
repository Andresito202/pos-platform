package co.camachopos.colombia.runtime

import android.content.Context
import java.io.File
import java.security.MessageDigest
import org.json.JSONObject

/** Verified commercial asset loader for the installed native runtime. */
object RuntimeAssets {
    private fun sha(file:File):String {
        val digest=MessageDigest.getInstance("SHA-256")
        file.inputStream().use { stream -> val buffer=ByteArray(65536);while(true){val count=stream.read(buffer);if(count<0)break;digest.update(buffer,0,count)} }
        return digest.digest().joinToString(""){"%02x".format(it)}
    }
    @Synchronized fun materialize(context:Context):File {
        val manifestText=context.assets.open("runtime/files.json").bufferedReader().use { it.readText() }
        val manifest=JSONObject(manifestText)
        val version=manifest.getString("bundle_id");check(version.matches(Regex("[a-f0-9]{64}")))
        val root=File(context.filesDir,"runtime-"+version.take(16)).apply { check(isDirectory||mkdirs()) }
        val files=manifest.getJSONObject("files")
        files.keys().forEach { path ->
            val destination=File(root,path).canonicalFile
            check(destination.path.startsWith(root.canonicalPath+File.separator)) { "BUNDLED_RUNTIME_PATH_REJECTED" }
            if(!destination.exists()) {
                check(destination.parentFile!!.isDirectory||destination.parentFile!!.mkdirs())
                val partial=File(destination.parentFile,destination.name+".partial")
                context.assets.open("runtime/"+path).use { input -> java.io.FileOutputStream(partial).use { target -> input.copyTo(target);target.fd.sync() } }
                check(sha(partial)==files.getString(path)) { "BUNDLED_RUNTIME_COPY_MISMATCH" }
                check(partial.renameTo(destination)) { "BUNDLED_RUNTIME_COMMIT_FAILED" }
            }
            check(sha(destination)==files.getString(path)) { "BUNDLED_RUNTIME_DIGEST_MISMATCH" }
        }
        check(files.has("runtime-service.mjs") && files.has("node_modules/better-sqlite3/lib/binding.js")) { "COMMERCIAL_RUNTIME_REQUIRED" }
        check(manifest.has("installed_native")) { "INSTALLED_NATIVE_REQUIRED" }
        run {
            val native=File(context.applicationInfo.nativeLibraryDir).canonicalFile
            check(native.path.startsWith("/data/app/")) {"INSTALLED_NATIVE_DIRECTORY_REQUIRED"}
            val files=manifest.getJSONObject("installed_native")
            check(files.has("libcamacho_node.so")&&files.has("libcamacho_sqlite.so")) {"INSTALLED_NATIVE_ENTRYPOINTS_REQUIRED"}
            files.keys().forEach {name->
                check(name.matches(Regex("lib[A-Za-z0-9_+.-]+\\.so")))
                val file=File(native,name).canonicalFile
                check(file.parentFile==native&&file.isFile&&sha(file)==files.getString(name)) {"INSTALLED_NATIVE_DIGEST_MISMATCH"}
            }
        }
        val manifestFile=android.util.AtomicFile(File(root,"files.json"))
        val stream=manifestFile.startWrite()
        try { stream.write(manifestText.toByteArray(Charsets.UTF_8));manifestFile.finishWrite(stream) } catch(e:Exception){manifestFile.failWrite(stream);throw e}
        return root
    }
    fun executable(context:Context,root:File):File {
        check(File(root,"files.json").isFile)
        return File(context.applicationInfo.nativeLibraryDir,"libcamacho_node.so")
    }
    fun libraries(context:Context,root:File):File = executable(context,root).parentFile!!
}

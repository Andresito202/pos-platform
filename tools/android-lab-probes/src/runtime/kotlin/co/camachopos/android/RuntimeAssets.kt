package co.camachopos.android

import android.content.Context
import java.io.File
import java.security.MessageDigest
import org.json.JSONObject

/** Shared verified asset loader; serializes probe/service extraction within this UID. */
object RuntimeAssets {
    private fun sha(file:File):String {
        val digest=MessageDigest.getInstance("SHA-256")
        file.inputStream().use { stream -> val buffer=ByteArray(65536);while(true){val count=stream.read(buffer);if(count<0)break;digest.update(buffer,0,count)} }
        return digest.digest().joinToString(""){"%02x".format(it)}
    }
    @Synchronized fun materialize(context:Context):File {
        val manifest=JSONObject(context.assets.open("runtime/files.json").bufferedReader().use { it.readText() })
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
        if(manifest.has("installed_native")) {
            val native=File(context.applicationInfo.nativeLibraryDir).canonicalFile
            check(native.path.startsWith("/data/app/")) {"INSTALLED_NATIVE_DIRECTORY_REQUIRED"}
            val files=manifest.getJSONObject("installed_native")
            check(files.has("libcamacho_node.so")&&files.has("libcamacho_sqlite.so")) {"INSTALLED_NATIVE_ENTRYPOINTS_REQUIRED"}
            files.keys().forEach {name->
                check(name.matches(Regex("lib[A-Za-z0-9_+.-]+\\.so")))
                val file=File(native,name).canonicalFile
                check(file.parentFile==native&&file.isFile&&sha(file)==files.getString(name)) {"INSTALLED_NATIVE_DIGEST_MISMATCH"}
            }
        } else {
            check(context.applicationInfo.targetSdkVersion<=28) {"WRITABLE_EXECUTABLE_FORBIDDEN_FOR_MODERN_TARGET"}
            check(File(root,"bin/node").setExecutable(true,true)) { "NODE_EXECUTION_MODE_FAILED" }
        }
        return root
    }
    fun executable(context:Context,root:File):File {
        val manifest=JSONObject(context.assets.open("runtime/files.json").bufferedReader().use {it.readText()})
        return if(manifest.has("installed_native"))File(context.applicationInfo.nativeLibraryDir,"libcamacho_node.so")
            else {check(context.applicationInfo.targetSdkVersion<=28);File(root,"bin/node")}
    }
    fun libraries(context:Context,root:File):File =
        if(executable(context,root).name=="libcamacho_node.so")File(context.applicationInfo.nativeLibraryDir) else File(root,"lib")
}

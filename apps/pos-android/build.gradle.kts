import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import java.util.zip.ZipOutputStream

plugins { kotlin("jvm") version "2.2.0" }
repositories { mavenCentral(); maven { url = uri("https://dl.google.com/dl/android/maven2/") } }
val aaptTool by configurations.creating
val dexTool by configurations.creating
val apkSigner by configurations.creating
dependencies {
    compileOnly("org.robolectric:android-all:9-robolectric-4913185-2")
    aaptTool("com.android.tools.build:aapt2:8.10.1-12782657:linux")
    dexTool("com.android.tools:r8:8.10.24")
    apkSigner("com.android.tools.build:apksig:8.10.1")
}
kotlin {
    jvmToolchain(17)
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_1_8) }
}
tasks.withType<JavaCompile>().configureEach { options.release.set(8) }

val runtime by sourceSets.creating {
    kotlin.srcDir("src/runtime/kotlin")
    compileClasspath += configurations.compileClasspath.get()
}
val runtimeHostJar by tasks.registering(Jar::class) {
    dependsOn(runtime.classesTaskName)
    from(runtime.output)
    archiveFileName.set("runtime-probe-host.jar")
}

fun registerProbeApk(name: String, runtimeVariant: Boolean) = tasks.register(name) {
    dependsOn(if(runtimeVariant) runtimeHostJar else tasks.jar)
    doLast {
        require(System.getProperty("os.name").lowercase().contains("linux")) { "Linux Docker build required" }
        val signerSource = file(providers.gradleProperty("signerSource").get())
        val keystore = file(providers.gradleProperty("probeSigning").get())
        require(signerSource.isFile && keystore.isFile) { "Lab signer and keystore required" }
        val out = layout.buildDirectory.dir(if(runtimeVariant) "runtime-apk" else "probe-apk").get().asFile.apply { mkdirs() }
        fun run(vararg args: String) {
            val process = ProcessBuilder(*args).redirectErrorStream(true).start()
            process.inputStream.bufferedReader().useLines { lines -> lines.forEach { println(it) } }
            check(process.waitFor() == 0) { "APK_TOOL_FAILED: ${args[0]}" }
        }
        val java = "${System.getProperty("java.home")}/bin/java"
        val javac = "${System.getProperty("java.home")}/bin/javac"
        copy { from(zipTree(aaptTool.singleFile)); into(file("${out}/aapt")) }
        val aapt = file("${out}/aapt/aapt2")
        check(aapt.setExecutable(true))
        val api = configurations.compileClasspath.get().files.single { it.name.startsWith("android-all-") }
        val manifest = file(if(runtimeVariant) "src/runtime/AndroidManifest.xml" else "src/main/AndroidManifest.xml")
        val assets = if(runtimeVariant) listOf("-A",file(providers.gradleProperty("runtimeAssets").get()).path) else emptyList()
        run(aapt.path, "link", "-o", "${out}/resources.apk", "--manifest", manifest.path, "-I", api.path,*assets.toTypedArray())
        val dex = file("${out}/dex").apply { mkdirs() }
        val stdlib = configurations.runtimeClasspath.get().files.filter { it.name.startsWith("kotlin-stdlib-") && !it.name.contains("jdk") }
        run(java, "-cp", dexTool.asPath, "com.android.tools.r8.D8", "--min-api", "28", "--lib", api.path,
            "--output", dex.path, (if(runtimeVariant) runtimeHostJar.get() else tasks.jar.get()).archiveFile.get().asFile.path, *stdlib.map { it.path }.toTypedArray())
        val unsigned = file("${out}/unsigned.apk")
        ZipOutputStream(unsigned.outputStream()).use { zip ->
            ZipFile(file("${out}/resources.apk")).use { source ->
                source.entries().asSequence().forEach { entry ->
                    zip.putNextEntry(ZipEntry(entry.name))
                    source.getInputStream(entry).use { it.copyTo(zip) }
                    zip.closeEntry()
                }
            }
            dex.listFiles()!!.filter { it.extension == "dex" }.forEach { item ->
                zip.putNextEntry(ZipEntry(item.name))
                item.inputStream().use { it.copyTo(zip) }
                zip.closeEntry()
            }
        }
        val apk = file("${out}/"+if(runtimeVariant) "camacho-node-runtime-probe.apk" else "camacho-sqlite-probe.apk")
        run(javac, "-cp", apkSigner.asPath, "-d", out.path, signerSource.path)
        run(java, "-cp", apkSigner.asPath + ":" + out.path,
            "SignApk", keystore.path, unsigned.path, apk.path)
        run(aapt.path, "dump", "badging", apk.path)
    }
}
registerProbeApk("probeApk",false)
registerProbeApk("runtimeProbeApk",true)

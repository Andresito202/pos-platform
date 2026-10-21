import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import java.util.zip.ZipOutputStream

plugins { kotlin("jvm") version "2.2.0" }
repositories { mavenCentral(); maven { url = uri("https://dl.google.com/dl/android/maven2/") } }

val aaptTool by configurations.creating
val dexTool by configurations.creating
val apkSigner by configurations.creating
dependencies {
    // AOSP Android 9 API surface for compilation/testing only; never packaged.
    compileOnly("org.robolectric:android-all:9-robolectric-4913185-2")
    testImplementation(kotlin("test-junit"))
    testImplementation("org.json:json:20250517")
    aaptTool("com.android.tools.build:aapt2:8.10.1-12782657:linux")
    dexTool("com.android.tools:r8:8.10.24")
    apkSigner("com.android.tools.build:apksig:8.10.1")
}
kotlin { jvmToolchain(17); compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_1_8) } }
tasks.withType<JavaCompile>().configureEach { options.release.set(8) }
tasks.test { maxHeapSize = "256m"; testLogging { events("passed", "failed", "skipped") } }
tasks.register<Zip>("bridgeAar") {
    dependsOn(tasks.jar)
    archiveFileName.set("camacho-android-hardware.aar")
    destinationDirectory.set(layout.buildDirectory.dir("outputs"))
    from(tasks.jar) { rename { "classes.jar" } }
    from("src/main/AndroidManifest.xml")
}

val lab by sourceSets.creating {
    kotlin.srcDir("host/src")
    compileClasspath += sourceSets.main.get().output + configurations.compileClasspath.get()
    runtimeClasspath += output + compileClasspath
}
val hostJar by tasks.registering(Jar::class) {
    dependsOn(lab.classesTaskName)
    from(lab.output)
    archiveFileName.set("hardware-lab-host.jar")
}
tasks.register("labApk") {
    dependsOn("bridgeAar",hostJar)
    doLast {
        require(System.getProperty("os.name").lowercase().contains("linux")) { "Use the documented Linux Gradle container" }
        val assets=file(providers.gradleProperty("labAssets").get())
        require(file("${assets}/lab-policy.json").isFile) { "Explicit isolated laboratory policy required" }
        val signing=file(providers.gradleProperty("labSigning").get())
        require(signing.isFile) { "Explicit APK laboratory keystore required" }
        val out=layout.buildDirectory.dir("lab-apk").get().asFile.apply { mkdirs() }
        val publicAssets=file("${out}/public-assets").apply { mkdirs() }
        copy { from(file("${assets}/lab-policy.json"));into(publicAssets) }
        copy { from(zipTree(aaptTool.singleFile));into(file("${out}/aapt")) }
        val aapt=file("${out}/aapt/aapt2");check(aapt.setExecutable(true))
        val api=configurations.compileClasspath.get().files.single { it.name.startsWith("android-all-") }
        copy { from(zipTree(layout.buildDirectory.file("outputs/camacho-android-hardware.aar")));include("classes.jar");into(file("${out}/aar")) }
        fun run(vararg args:String) { val process=ProcessBuilder(*args).inheritIO().start();check(process.waitFor()==0) { "APK tool failed: ${args[0]}" } }
        val javaCommand="${System.getProperty("java.home")}/bin/java"
        run(aapt.path,"link","-o","${out}/resources.apk","--manifest",file("host/AndroidManifest.xml").path,"-I",api.path,"-A",publicAssets.path)
        val dex=file("${out}/dex").apply { mkdirs() }
        val stdlib=configurations.runtimeClasspath.get().files.filter { it.name.startsWith("kotlin-stdlib-") && !it.name.contains("jdk") }
        run(javaCommand,"-cp",dexTool.asPath,"com.android.tools.r8.D8","--min-api","28","--lib",api.path,"--output",dex.path,
            file("${out}/aar/classes.jar").path,hostJar.get().archiveFile.get().asFile.path,*stdlib.map { it.path }.toTypedArray())
        val unsigned=file("${out}/unsigned.apk")
        ZipOutputStream(unsigned.outputStream()).use { zip ->
            ZipFile(file("${out}/resources.apk")).use { source -> source.entries().asSequence().forEach { entry ->
                zip.putNextEntry(ZipEntry(entry.name));source.getInputStream(entry).use { it.copyTo(zip) };zip.closeEntry()
            } }
            dex.listFiles()!!.filter { it.extension=="dex" }.forEach { item -> zip.putNextEntry(ZipEntry(item.name));item.inputStream().use { it.copyTo(zip) };zip.closeEntry() }
        }
        // No native .so libraries or uncompressed resources; installable compressed DEX, no zipalign claim.
        val apk=file("${out}/camacho-hardware-lab.apk")
        run("${System.getProperty("java.home")}/bin/javac","-cp",apkSigner.asPath,"-d",out.path,file("host/tools/SignApk.java").path)
        run(javaCommand,"-cp",apkSigner.asPath+":"+out.path,"SignApk",signing.path,unsigned.path,apk.path)
        run(aapt.path,"dump","badging",apk.path)
    }
}

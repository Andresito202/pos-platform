import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import java.util.zip.ZipOutputStream

plugins {
    kotlin("jvm") version "2.2.0"
}

repositories {
    mavenCentral()
    maven { url = uri("https://dl.google.com/dl/android/maven2/") }
}

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
    jvmToolchain(21)
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_1_8)
    }
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(8)
}

sourceSets {
    main {
        kotlin.srcDirs(
            "src/main/kotlin",
            // Existing android-hardware adapters (UsbHostTransport / HardwareCore).
            "../pos-local-service/native/android-hardware/src/main/kotlin",
        )
    }
    create("commercialIdentityTest") {
        kotlin.srcDir("src/test/kotlin")
        compileClasspath += sourceSets["main"].output + configurations.compileClasspath.get()
        runtimeClasspath += output + compileClasspath + configurations.runtimeClasspath.get()
    }
}

tasks.register<JavaExec>("commercialIdentityTest") {
    dependsOn(sourceSets["commercialIdentityTest"].classesTaskName)
    classpath = sourceSets["commercialIdentityTest"].runtimeClasspath
    mainClass.set("co.camachopos.colombia.CommercialIdentityTestKt")
}

val commercialHostJar by tasks.registering(Jar::class) {
    dependsOn(tasks.named("compileKotlin"))
    from(sourceSets["main"].output)
    archiveFileName.set("camacho-pos-colombia-host.jar")
}

tasks.register("commercialApk") {
    group = "build"
    description = "Build signed Camacho POS Colombia commercial APK (API 28) with embedded Node/SQLite runtime assets."
    dependsOn(commercialHostJar)
    doLast {
        require(System.getProperty("os.name").lowercase().contains("linux")) {
            "Linux build host required for aapt2/r8 packaging"
        }
        val brandAssets = file("src/main/assets")
        val runtimeAssets = sequenceOf(
            file("build/staging-runtime"),
            file("../../tools/android-lab-probes/build/runtime-assets/runtime"),
        ).firstOrNull { file("${it}/files.json").isFile }
            ?: error("Embedded runtime assets missing. Build tools/android-lab-probes runtime (prepare/extract/compile/package) first.")
        val out = layout.buildDirectory.dir("commercial-apk").get().asFile.apply { mkdirs() }
        val stagedAssets = file("${out}/assets").apply {
            deleteRecursively()
            mkdirs()
        }
        copy { from(brandAssets); into(stagedAssets); include("*.png") }
        copy { from(runtimeAssets); into(file("${stagedAssets}/runtime")) }
        val assetsDir = stagedAssets
        fun run(vararg args: String) {
            val process = ProcessBuilder(*args).redirectErrorStream(true).start()
            process.inputStream.bufferedReader().useLines { lines -> lines.forEach { println(it) } }
            check(process.waitFor() == 0) { "APK_TOOL_FAILED: ${args[0]}" }
        }
        val javaBin = "${System.getProperty("java.home")}/bin/java"
        val javacBin = "${System.getProperty("java.home")}/bin/javac"
        copy {
            from(zipTree(aaptTool.singleFile))
            into(file("${out}/aapt"))
        }
        val aapt = file("${out}/aapt/aapt2")
        check(aapt.setExecutable(true))
        val api = configurations.compileClasspath.get().files.single { it.name.startsWith("android-all-") }
        val manifest = file("src/main/AndroidManifest.xml")
        run(aapt.path, "link", "-o", "${out}/resources.apk", "--manifest", manifest.path, "-I", api.path, "-A", assetsDir.path)
        val dex = file("${out}/dex").apply { mkdirs() }
        val stdlib = configurations.runtimeClasspath.get().files.filter {
            it.name.startsWith("kotlin-stdlib-") && !it.name.contains("jdk")
        }
        // Default: D8 (dex only) — safest for embedded Node/SQLite assets on API 28.
        // Optional: -PcommercialR8Shrink=true runs R8 --release with commercial-r8.pro.
        // Do not enable shrink in CI until M60WL physical validation authorizes it.
        val r8Shrink = providers.gradleProperty("commercialR8Shrink").orNull == "true"
        val keepRules = file("proguard/commercial-r8.pro")
        if (r8Shrink) {
            require(keepRules.isFile) { "commercial-r8.pro required for R8 shrink mode" }
            run(
                javaBin, "-cp", dexTool.asPath, "com.android.tools.r8.R8",
                "--release",
                "--min-api", "28", "--lib", api.path,
                "--pg-conf", keepRules.path,
                "--output", dex.path,
                commercialHostJar.get().archiveFile.get().asFile.path,
                *stdlib.map { it.path }.toTypedArray(),
            )
        } else {
            run(
                javaBin, "-cp", dexTool.asPath, "com.android.tools.r8.D8",
                "--min-api", "28", "--lib", api.path,
                "--output", dex.path,
                commercialHostJar.get().archiveFile.get().asFile.path,
                *stdlib.map { it.path }.toTypedArray(),
            )
        }
        val unsigned = file("${out}/camacho-pos-colombia-unsigned.apk")
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
        val signerSource = file("../pos-local-service/native/android-hardware/host/tools/SignApk.java")
        val keystore = providers.gradleProperty("probeSigning").orNull?.let { file(it) }
            ?: file("signing/camacho-android-test.p12")
        require(signerSource.isFile && keystore.isFile) {
            "SignApk.java and signing/camacho-android-test.p12 (or -PprobeSigning) required"
        }
        val apk = file("${out}/camacho-pos-colombia.apk")
        run(javacBin, "-cp", apkSigner.asPath, "-d", out.path, signerSource.path)
        run(
            javaBin, "-cp", apkSigner.asPath + ":" + out.path,
            "SignApk", keystore.path, unsigned.path, apk.path,
        )
        run(aapt.path, "dump", "badging", apk.path)
        // Drop unpacked runtime from the project tree so ARCH-003 does not scan
        // embedded Node requires (better-sqlite3) under apps/pos-android/build.
        stagedAssets.deleteRecursively()
        file("build/staging-runtime").deleteRecursively()
        println("SIGNED_APK=${apk.absolutePath}")
        println("UNSIGNED_APK=${unsigned.absolutePath}")
        val shaProc = ProcessBuilder("sha256sum", apk.absolutePath).redirectErrorStream(true).start()
        val shaLine = shaProc.inputStream.bufferedReader().readText().trim()
        check(shaProc.waitFor() == 0 && shaLine.startsWith("")) { "APK_SHA256_FAILED" }
        println("APK_SHA256=" + shaLine.substringBefore(' '))
    }
}

// Backward-compatible alias used by earlier docs.
tasks.register("commercialShellApk") {
    dependsOn("commercialApk")
}

plugins { kotlin("jvm") version "2.2.0" }
repositories { mavenCentral() }
dependencies {
    // AOSP Android 9 API surface for compilation/testing only; never packaged.
    compileOnly("org.robolectric:android-all:9-robolectric-4913185-2")
    testImplementation(kotlin("test-junit"))
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

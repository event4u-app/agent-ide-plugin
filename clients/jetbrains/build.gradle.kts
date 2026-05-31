import org.jetbrains.intellij.platform.gradle.IntelliJPlatformType

plugins {
    kotlin("jvm") version "2.1.0"
    kotlin("plugin.serialization") version "2.1.0"
    id("org.jetbrains.intellij.platform") version "2.2.1"
    id("io.gitlab.arturbosch.detekt") version "1.23.7"
    id("org.jlleitschuh.gradle.ktlint") version "12.1.2"
}

group = "de.event4u.agent"
version = "0.1.0"

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        // Platform pin bumped from 2024.2 → 2025.1 so the sandbox IDE's
        // GradleJvmSupportMatrix can parse Java 25 versions in its bundled
        // jvm-compat data file. 2024.2 was released before Java 25 (Sept
        // 2025) and its parser throws `IllegalArgumentException: 25` on
        // startup — non-fatal but the error dialog is noisy.
        create(IntelliJPlatformType.IntellijIdeaCommunity, "2025.1")
        instrumentationTools()
    }
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")

    testImplementation("org.junit.jupiter:junit-jupiter:5.10.3")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test {
    useJUnitPlatform()
}

// T-PRD11 — bundle the Agent Core sidecar into the plugin distribution so an
// installed plugin ZIP runs with NO repo checkout. `SidecarPathResolver` looks
// for `<pluginPath>/sidecar/server.js`; `prepareSandbox` (which `buildPlugin`
// zips) places it there. The directory `from` is tolerant of a missing source:
// the `check`-only CI job does not build the Node core, so it produces a plugin
// without the sidecar (fine — it asserts nothing about it); the `package` job
// builds the core first, so the ZIP carries `server.js`. AI council Fork 3A,
// ADR-017.
tasks.named<org.jetbrains.intellij.platform.gradle.tasks.PrepareSandboxTask>("prepareSandbox") {
    from(layout.projectDirectory.dir("../../packages/core/dist")) {
        include("server.js")
        into(pluginName.map { "$it/sidecar" })
    }
}

intellijPlatform {
    pluginConfiguration {
        id = "de.event4u.agent"
        name = "event4u Agent"
        version = project.version.toString()
        ideaVersion {
            // Raised from "242" to "251" (2025.1) together with the platform
            // dep bump — see dependencies{} note above on Java 25 parsing.
            sinceBuild = "251"
            untilBuild = provider { null }
        }
    }
}

kotlin {
    jvmToolchain(17)
}

detekt {
    buildUponDefaultConfig = true
    allRules = false
}

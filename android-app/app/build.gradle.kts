plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.sakuraedge.minimark"
    compileSdk = 35
    buildToolsVersion = "35.0.0"

    defaultConfig {
        applicationId = "com.sakuraedge.minimark"
        minSdk = 26
        targetSdk = 35
        versionCode = 105
        versionName = "1.0.5"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        create("distribution") {
            val keystore = providers.environmentVariable("MINIMARK_ANDROID_KEYSTORE").orNull
            if (keystore != null) {
                storeFile = file(keystore)
                storePassword = providers.environmentVariable("MINIMARK_ANDROID_STORE_PASSWORD").orNull
                keyAlias = providers.environmentVariable("MINIMARK_ANDROID_KEY_ALIAS").orNull
                keyPassword = providers.environmentVariable("MINIMARK_ANDROID_KEY_PASSWORD").orNull
            }
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("distribution")
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions { jvmTarget = "17" }
    buildFeatures { buildConfig = true }
    testOptions { unitTests.isIncludeAndroidResources = true }
    sourceSets.getByName("main").assets.srcDir(layout.buildDirectory.dir("generated/web-assets"))
}

val buildSharedWeb by tasks.registering(Exec::class) {
    workingDir(rootProject.projectDir.parentFile)
    commandLine(if (System.getProperty("os.name").startsWith("Windows")) "npm.cmd" else "npm", "run", "build")
    inputs.dir("../../src")
    inputs.dir("../../public")
    inputs.file("../../package-lock.json")
    inputs.file("../../package.json")
    inputs.file("../../vite.config.ts")
    inputs.file("../../index.html")
    outputs.dir("../../dist")
}
val copySharedWeb by tasks.registering(Sync::class) {
    dependsOn(buildSharedWeb)
    from("../../dist") { exclude("**/*.map") }
    into(layout.buildDirectory.dir("generated/web-assets/web"))
}
tasks.named("preBuild").configure { dependsOn(copySharedWeb) }

dependencies {
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.activity:activity-ktx:1.10.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("androidx.compose.runtime:runtime")
    implementation("androidx.compose.ui:ui-text")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.14.1")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0")
}

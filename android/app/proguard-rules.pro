# Capacitor bridge — must not be obfuscated
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin { *; }

# App package — keep classes accessible from the WebView bridge
-keep class com.treforged.forged.** { *; }

# WebView JavaScript interface methods
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Preserve stack traces in crash reports
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Kotlin metadata (required for coroutines and reflection)
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod

# Kotlin coroutines
-keepclassmembernames class kotlinx.** {
    volatile <fields>;
}

# AndroidX
-keep class androidx.** { *; }
-dontwarn androidx.**

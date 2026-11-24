# Camacho POS Colombia — optional R8 full mode keep rules (API 28 / M60WL).
# Default commercialApk uses D8 (dex only). Enable shrink with -PcommercialR8Shrink=true
# after validating embedded Node/SQLite assets on device. Never ship private keys.

-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod
-keep class co.camachopos.colombia.** { *; }
-keep class co.camachopos.colombia.security.** { *; }
# JNI / Node embedded runtime bridges (names must survive shrink).
-keepclasseswithmembernames class * { native <methods>; }
-dontwarn javax.**
-dontwarn org.bouncycastle.**

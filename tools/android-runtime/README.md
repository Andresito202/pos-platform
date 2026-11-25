# Android commercial runtime

Build from the repository root with the locked pnpm dependencies installed. Linux ARM64 cross-compilation requires Android NDK r27d (27.3.13750724), Python without optimization, GPG and the pinned runtime input lock. No probe executable is packaged.

The preparation, signed metadata verification, extraction, native compilation, asset packaging and installed-native derivation must succeed before APK assembly. A prepared bundle is not a signed or physically certified release. Never substitute test signing keys or a diagnostic runtime. Review input lock changes explicitly.

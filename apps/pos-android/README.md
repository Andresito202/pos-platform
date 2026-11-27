# Camacho POS Colombia Android

Native commercial client for the shared local service. Build the verified installed runtime in `tools/android-runtime/build/installed-runtime` before Gradle APK assembly. The APK is unsigned until the explicit release signing process is completed. No laboratory authorization or test key is included. Hardware discovery is not physical dispatch certification.

For an enrolled installation with a paid register allocated in Central, an installer can configure `license_activation` in the managed Android commercial provision. Set `activation_id` to the issued Central allocation ID, `register_id` to the assigned register and `keys` to the installer-trusted license signing key records. Set `POS_LICENSE_CAPACITY_PROVISION_FILE` to the absolute, private local artifact path. BUSINESS login resolves the allocation with DeviceProof and accepts the signed artifact for the configured branch and register before requesting PKCE. Offline session recovery uses local state and requires no allocation download.

Set the managed Android provision field `sync_origin` to the HTTPS origin of Central Sync. This enables background delivery of the existing SQLite outbox using the enrolled device credential, including recovery after a service restart. The Sync origin may differ from the BUSINESS login origin.

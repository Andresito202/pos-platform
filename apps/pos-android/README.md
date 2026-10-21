# Camacho POS — isolated Android SQLite feasibility probe

This module intentionally contains **source only**, not a built APK and not the commercial POS. It targets Android 9 (API 28+) and uses Android's built-in SQLite API in app-private storage. No INTERNET, USB, drawer, payment, or fiscal functionality.

Checks at activity launch:
- SQLite write and read, inside a committed transaction.
- A second deliberately uncommitted transaction rolls back.
- Database is closed and reopened; persisted row remains and rollback row is absent.
- Relaunch the Activity to check durability across process lifetime.

This probe does **not** establish compatibility with `better-sqlite3`, Node.js, commercial migrations, or any production authorization store. The Android build integration remains to be implemented in an isolated test module with a dedicated signing key and native build configuration. Do not replace the existing Hardware LAB signing setup or modify commercial schema.

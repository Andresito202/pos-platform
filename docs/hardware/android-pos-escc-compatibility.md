# Android POS hardware compatibility — verified observations

**Status:** partial field observation, NOT a certified hardware integration.
**Recorded:** 2026-10-22.
**Maintainer area:** Camacho POS Colombia — Android peripheral interoperability.

## Grounded field observation

- A **borrowed Android POS terminal** has an integrated receipt printer and connected cash drawer.
- The user reports that, after installing **ESCC POS USB PRINT SERVICE** on that terminal, the cash drawer opened successfully while using the existing cloud/browser POS **MásControlApp**.
- This is a **reported successful real-device test**, not a Camacho POS test. It does **not** prove which vendor protocol or command ESCC sent, whether drawer pulses are routed through the printer, or whether other terminals behave the same.
- The user would like to return the borrowed terminal. Never make it a permanent build or deployment dependency.

## Unknown until device evidence is collected

Manufacturer, product/model, Android release, build fingerprint, CPU ABI, printer vendor and PID/VID, drawer interface, USB topology, ESCC package identifier/version/signature, supported SDK/API, print/drawer commands, permissions, installed service component and reliable compatibility scope are **unknown**. Do not infer them from the app's displayed name.

## Engineering decision

1. Build a **platform-neutral peripheral contract** for printing and cash-drawer actions, with Android, Windows and Linux adapter selection based on verified capabilities; preserve offline/local-first behavior.
2. Treat ESCC as a **documented fallback/proven-on-one-terminal observation**, not a mandatory runtime dependency, a bundled proprietary APK or an implicit endorsement.
3. Do not copy/reverse engineer proprietary binaries, bypass vendor licensing, or add unauthorized APKs to the repository. Do not commit device serials, Android IDs, MAC addresses, account data, web credentials, access tokens, application databases or business/customer receipts.
4. Physical cash-drawer support requires proof on real hardware; a simulator is useful for software contracts but **cannot certify the electrical drawer pulse**.
5. Coordinate changes with the active Codex working tree. This reference document must not overwrite active authentication changes.

## Collect evidence if the borrowed terminal is still available

With the owner's permission, enable ADB temporarily and create a **redacted** hardware inventory: `adb devices -l`, `getprop ro.product.manufacturer`, `ro.product.model`, `ro.build.version.release`, `ro.build.version.sdk`, `ro.product.cpu.abi`, `pm list packages`, and non-sensitive USB/printer-service observations. Confirm the exact package associated with ESCC before collecting version metadata. Do not assume ADB is enabled or that the device is connected to an environment accessible to Codex or ChatGPT.

Store a reviewed/sanitized markdown summary **next to this file** as `android-pos-device-profile.md`. Keep full raw exports and any consented APK outside Git or in an approved restricted artifact store; never place raw personal/device identifiers in Git history.

## Acceptance tests for Camacho POS

- Android login, sales, receipts and payment confirmation.
- Print a real receipt with measured width, font and paper behavior.
- Open the physical cash drawer and document the actual transport + command path.
- Test disconnect/reconnect, permission denial, printer unavailable and retry safeguards.
- Ensure the drawer does not open on an unconfirmed payment; test manual opening subject to configured role permissions.
- Re-run on target hardware; distinguish emulated adapter tests from physical validation.

## Codex / agent retrieval note

Search for **`docs/hardware/android-pos-escc-compatibility.md`** when modifying Android device support, ESC/POS integration, printer discovery, USB access or cash-drawer control. Prefer evidence in the verified device profile once collected.

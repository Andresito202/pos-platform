# Wave 6 — Windows hardware recovery

Base: 8e3fbda456326cf0ef4024b2a5985122cffa22c5. Source: PR #106, 9922e91c. This first cut restores the existing hardware contracts, transport adapters, durable job store, receipt projection and their original tests. SQLite hardware tables are already in main; no new migration. No new runtime entry point or service.

## Evidence boundaries

Owner-reported external Windows bench observations from 2026-11-15: CH340 VID 1A86 PID 7523, COM5, 9600 8N1, readings 000.000 and 000.265; Xprinter XP-82V, XP-80C driver, USB001; cash drawer attached to printer, raw ESC/POS pulse opened externally. Original raw logs and physical device are not accessible in this verification session. These observations do not certify Camacho POS or authorize a production hardware profile.

## Remaining before merge

- Verify the existing adapters against current main and run original tests; check post-merge main CI independently.
- Connect hardware.command through existing IPC and commercial authorization, preserving identity and role isolation. Do not enable automatic drawer or change local-role grants until policy and device binding are verified.
- Connect persisted receipt and confirmed cash payment, prevent duplicate physical side effects; distinguish transport accepted from physical output.
- Recover or implement a verified serial parser for the actual CH340 frames and connect weight to the existing sale quantity. The recovered printer hardware contract does not implement scale reads. No assumed stability flag, unit or frame terminator.
- Device-specific configured profiles and physical product-flow evidence remain pending. SCM commercial and Authenticode gates stay frozen; FACTUS is out of scope.

No physical certification or release claim is made by this recovery cut.

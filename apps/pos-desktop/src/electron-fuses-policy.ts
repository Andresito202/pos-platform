/**
 * Electron security fuses required for Camacho POS Desktop packaging.
 * Applied via electron-builder `electronFuses` (DEC-010 packager). Presence in
 * this module is the allowlisted policy; packaging must not weaken these.
 */
export const ELECTRON_FUSES_POLICY = Object.freeze({
  runAsNode: false,
  enableCookieEncryption: true,
  enableNodeOptionsEnvironmentVariable: false,
  enableNodeCliInspectArguments: false,
  enableEmbeddedAsarIntegrityValidation: true,
  onlyLoadAppFromAsar: true,
  loadBrowserProcessSpecificV8Snapshot: true,
} as const);

export type ElectronFusesPolicy = typeof ELECTRON_FUSES_POLICY;

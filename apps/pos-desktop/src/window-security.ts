export const WINDOW_SECURITY_CONFIG = {
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    navigateOnDragDrop: false,
  },
} as const;

export type WindowSecurityConfig = typeof WINDOW_SECURITY_CONFIG;

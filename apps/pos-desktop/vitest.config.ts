import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    setupFiles: ["./tests/renderer/setup.ts"],
    // `e2e/` es territorio de Playwright: lanza la aplicación Electron
    // compilada. Vitest recogía `e2e/boot.spec.ts` por el patrón por defecto y
    // fallaba al importar `@playwright/test`.
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**"],
  },
});

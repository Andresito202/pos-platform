import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { PRELOAD_FILENAME } from "./src/build-layout.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * El preload se emite en **CommonJS**, y no es una preferencia de estilo.
 *
 * `WINDOW_SECURITY_CONFIG` declara `sandbox: true`, y un preload sandboxeado en
 * Electron **no admite ESM**: el módulo no carga y `contextBridge` nunca llega a
 * ejecutarse, de modo que `window.posService` queda indefinido y toda la
 * superficie comercial resulta inalcanzable —sin error en la ventana—.
 *
 * Verificado por mutación: con `formats: ["es"]` la ventana abre igual, pero
 * `window.posService` queda vacío y la prueba de arranque lo detecta.
 */
export default defineConfig({
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: resolve(__dirname, "src/preload.ts"),
      formats: ["cjs"],
      fileName: () => PRELOAD_FILENAME,
    },
    rollupOptions: { external: ["electron"] },
  },
});

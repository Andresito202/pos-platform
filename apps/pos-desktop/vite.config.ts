import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { RENDERER_DIRECTORY } from "./src/build-layout.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname, "renderer"),
  // Rutas relativas: la ventana carga el renderer con `win.loadFile`, es decir
  // sobre `file://`. Con la base absoluta por defecto, `/assets/…` resuelve
  // contra la raíz del sistema de archivos y el bundle **nunca se descarga**:
  // la ventana abre en blanco sin un solo error visible.
  base: "./",
  build: {
    outDir: resolve(__dirname, "dist", RENDERER_DIRECTORY),
    emptyOutDir: true,
  },
});

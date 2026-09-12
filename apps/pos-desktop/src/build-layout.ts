/**
 * Nombres de los artefactos de build, en un solo sitio.
 *
 * Existen porque su divergencia **no produce ningún error visible**: un preload
 * que no carga deja `window.posService` indefinido y una ventana en blanco. El
 * proceso principal y las configuraciones de Vite leen de aquí, de modo que
 * renombrar un artefacto sin actualizar a su consumidor rompe la compilación en
 * vez de romper la caja.
 */

/**
 * Lo que decide es el **formato**, no el nombre: `WINDOW_SECURITY_CONFIG`
 * declara `sandbox: true`, y un preload sandboxeado **no admite ESM**. Emitirlo
 * como módulo ES deja `window.posService` indefinido —comprobado: mutar
 * `vite.preload.config.ts` a `formats: ["es"]` hace fallar la prueba de arranque
 * que verifica la superficie expuesta—.
 *
 * La extensión `.cjs` no es la causa, es la señal: el paquete declara
 * `"type": "module"`, así que un `.cjs` deja explícito ante cualquier lector
 * que este artefacto es CommonJS a propósito.
 */
export const PRELOAD_FILENAME = "preload.cjs";

/** Directorio del renderer compilado, relativo al proceso principal emitido. */
export const RENDERER_DIRECTORY = "renderer";

/** Documento que `BrowserWindow.loadFile` abre. */
export const RENDERER_ENTRY_FILENAME = "index.html";

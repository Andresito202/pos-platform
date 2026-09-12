/**
 * Entrada de Electron **exclusiva de E2E**.
 *
 * `src/main.ts` exporta `bootstrap(serviceChannel)` y **no se auto-ejecuta**: el
 * canal hacia el POS Local Service se le inyecta. Desde el Bloque 4 existe el
 * adaptador real —`src/local-service-channel.ts` sobre
 * `@pos-platform/local-channel`—, pero la entrada de producción sigue
 * bloqueada: el protocolo exige firmar **desde la primera trama**, y decidir de
 * dónde sale esa clave sin entregarle al Desktop el secreto persistente es una
 * decisión abierta.
 *
 * Este archivo **no es esa entrada**. Es un doble de prueba, del mismo tipo que
 * `makeServiceChannel()` en `tests/main.test.ts`, y sirve para una sola cosa:
 * comprobar que el proceso principal compilado arranca de verdad, que carga el
 * preload y el renderer compilados, y que `window.posService` queda expuesto.
 * No demuestra que el POS hable con su servicio.
 */
import { bootstrap } from "../dist/main.js";

const stubChannel = {
  request: () => Promise.resolve({
    status: "SUCCEEDED",
    result_code: "OK",
    result: null,
  }),
  close: () => Promise.resolve(),
};

/**
 * Sin `await` de nivel superior, y es necesario: `bootstrap` no resuelve hasta
 * que `app.whenReady()` lo hace, y un módulo principal que no termina de
 * cargarse deja colgado a cualquier supervisor que espere a que Electron esté
 * listo —Playwright entre ellos—. La entrada de producción tendrá la misma
 * restricción.
 */
bootstrap(stubChannel).catch((error) => {
  console.error("smoke-entry bootstrap failed", error);
  process.exit(1);
});

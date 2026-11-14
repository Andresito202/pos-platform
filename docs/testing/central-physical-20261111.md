# Central: evidencia física del 11 de noviembre de 2026

Base de producto inspeccionada: e6abad6ebdc04a4d44875946cbe5b48163d9fe5a. Este incremento corrige el montaje de pruebas y agrega verificaciones HTTP de las consultas nuevas. No rebaja autorizaciones ni controles comerciales.

## Resultados

| Comprobación | Resultado | Alcance |
|---|---|---|
| TypeScript Central completo | PASS | @simplewebauthn/server 14.0.3 disponible |
| Suite Central sin PostgreSQL | 224 PASS, 296 SKIP | 38 archivos aprobados y 11 omitidos |
| factus-pay-physical.test.ts | 1 PASS | PostgreSQL real, HTTPS, ingreso de webhook, ledger y duplicados |
| subscription-quotes-physical.test.ts | 7 PASS | Cotizaciones, pagos, GLOBAL, contratos, capacidad y revocación |
| Endpoints nuevos | PASS dentro del escenario de capacidad | assignment-context y activations sobre HTTPS/sesión/SQL; CSRF incorrecto, permiso insuficiente y scope añadido rechazados |
| Electron Windows visual | NO EJECUTADO | Helper de named pipe condicionado a win32 |
| Factus sandbox externo | NO EJECUTADO | Proveedor representado por servidor TLS local |

Los dos archivos físicos suman **8 PASS, 0 FAIL**, duración observada 15,59 s. PostgreSQL **16.14** Linux x64, loopback 55433, bases temporales y roles reales. La prueba de capacidad incluye el probe SQLite local: Linux no acredita Windows. WebAuthn usa aserciones criptográficas de prueba, no autenticador humano físico. No se emitió ninguna factura electrónica externa ni se cobró dinero real.

## Fallos y correcciones

- PostgreSQL 18.6 falló la introspección estricta. Se repitió con 16.14, versión de compose.yaml, sin relajar checks.
- OpenSSL estaba fijado a una ruta Windows en dos suites. Ahora comparte el resolvedor de laboratorio: OPENSSL_EXECUTABLE, Git Windows si existe, o openssl del PATH. Certificados temporales, sin instalarlos en el sistema.
- Las copias de fuentes sin .git admiten FIXTURE_REPOSITORY_COMMIT explícito de 40 caracteres hexadecimales. Sin esa variable se conserva git rev-parse HEAD. Debe ser el SHA real de las fuentes inspeccionadas, nunca uno inventado.
- El escenario de capacidad acepta 022 APPLIED o ALREADY_APPLIED porque la suite anterior puede haberla aplicado. La repetición debe ser íntegramente ALREADY_APPLIED; el runner sigue validando checksums y roles.
- El fixture reutiliza LICENSE_ISSUE y su grant activo cuando un escenario anterior ya los creó, evitando duplicados. No cambia permisos comerciales.
- El bloque visual de Electron solo corre en win32; en Linux informa WINDOWS_ELECTRON_PLATFORM_GATE_NOT_EXECUTED. HTTP/SQL, revocación de credencial y logout siguen ejecutándose. No interpretar el PASS del escenario GLOBAL como PASS de su bloque Windows.

## Reproducción

Dependencias fijadas del repositorio y PostgreSQL **16.14** desechable en localhost:55433. Configurar POSTGRES_TEST_URL de forma segura; nunca apuntar al VPS comercial. Las suites crean/eliminan sus bases y preparan roles de laboratorio.

Desde apps/central-authority:

```sh
pnpm exec tsc -p tsconfig.json
pnpm exec vitest run tests/factus-pay-physical.test.ts tests/subscription-quotes-physical.test.ts --no-file-parallelism
```

FIXTURE_REPOSITORY_COMMIT solo es necesario sin .git; OPENSSL_EXECUTABLE es opcional. En este executor, PostgreSQL y Vitest se lanzaron bajo el mismo proceso para compartir loopback, con socket Unix deshabilitado. PostgreSQL se detuvo al terminar. El paquete externo de validación no se añadió al producto ni modificó package.json/pnpm-lock.yaml. Otras dependencias proceden de caché: no constituye una instalación íntegra con frozen-lockfile.

## Pendientes que esta evidencia no cierra

Sandbox externo Factus Pay, facturación electrónica externa, UI completa por roles, Electron Windows/SCM, Android comercial, hardware y VPS/dominio. Falta acreditar los recorridos comerciales sobre los dispositivos y comparar el diseño contra las referencias.

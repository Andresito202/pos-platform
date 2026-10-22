# Autenticación nativa: incremento posterior a la custodia HTTP

Continúa `114b88125a1a4c7c0e38f0f098da8d907e501b04`, rama
`feat/android-commercial-runtime`, PR #96 draft. Se conservó por fast-forward
el commit concurrente documental `2dc680a8`, sin modificar su archivo de hardware.
La [evidencia del backend](business-browser-https-2026-10-22.md) conserva sus
resultados y fallos iniciales. No se tocaron bases persistentes, dispositivos,
credenciales instaladas, SSA, grants, Windows/Linux existentes ni React.

## Componentes y límites efectivos

| Componente | Implementación y evidencia | Límite |
| --- | --- | --- |
| Registro nativo | Se trasladó el validador de metadata existente a contracts, manteniendo reexport compatible en Central. Electron conserva callback/puerto exactos; Android exige App Link HTTPS, paquete y SHA-256 del firmante explícitos. Catálogo, callback y emisor PKCE reutilizan ese registro | No certifica dominio/DAL, no modifica inspectD3DeploymentEvidence ni aprueba un cliente |
| HTTPS BUSINESS | Cookie canónica → DeviceProof → código → canje atómico funciona también con registro Android. Se rechaza canje como otro cliente. JWT alterado rechazado; refresh emitido por HTTPS rota internamente y su replay revoca la familia | La rotación probada es la clase interna existente, **no** un grant refresh HTTP. El proof delegado conserva la ruta SSA; no firma el envelope /authorize |
| Recuperación del navegador | Tras perder CSRF, las operaciones protegidas rechazan. Un nuevo begin exige contraseña y elimina la cookie ambiente; complete exige WebAuthn fresco y emite otra cookie aleatoria | No reutiliza cookie/UUID como prueba ni afirma revocación global de sesiones previas. Logout verificado sigue siendo la transacción de revocación explícita |
| Electron main | Listener real exclusivo 127.0.0.1, state/verifier aleatorios y S256, callback de un uso, canje con TLS del sistema, límites/no redirects/no-store. Wrapper usa shell.openExternal; no canal nuevo de preload | Wrapper no montado en production-entry. Apertura real del navegador/ceremonia humana pendientes; no se ejecutaron con un dominio inventado. Puerto dinámico requiere regla central aprobada |
| Custodia Windows | safeStorage real en Electron/Windows: cifrado, recuperación y borrado observados con perfil temporal. Tokens sólo en custodia cifrada de main, nunca localStorage/React. Lease local impide que una respuesta de un usuario anterior sobrescriba al nuevo | No persistencia de refresh entre reinicios sin política aprobada; reinicio exige nuevo login. Se eliminan buffers/referencias, sin prometer borrado físico de strings JavaScript en RAM. Borrar custodia no equivale a revocación central |
| Android | PKCE/callback y TTL monotónico, pérdida de estado/cancelación/replay; verificador HTTPS DAL + firmante instalado; apertura ACTION_VIEW al navegador. Activity privada y Binder mismo UID para entregar una vez el código al consumidor nativo | La Activity queda **no exportada**, sin filtro externo. No se añadió INTERNET ni un permiso nuevo. DAL de un dominio real y verificación del intent-filter por Android no probados. No se extiende el pipe existente con comandos ad hoc: Node sigue aceptando STOP únicamente |
| Artefactos Android | Generador desde metadata suministrada: assetlinks.json y filtro exacto de callback, sin editar/publicar/activar. Host Kotlin compilado y APK lab firmado v2, assets verificados | Nada publicado como asociación de un dominio real. APK no instalado ni ejecutado en M60WL en este incremento |

Las rutas productivas de `main.ts` permanecen bloqueadas. El entry browser GET
propuesto por los clientes, su interfaz WebAuthn y el enlace final al servicio
**no se consideran implementados/conectados**. Falta especificar/aprobar primero
el binding navegador/nativo/dispositivo y refresh, detallado en la **misma**
[solicitud consolidada](android-commercial-approval-proposal-2026-10-22.md).
El cliente aún no conoce el BUSINESS cuando abre el navegador y el proof actual
lo exige: no se resolvió pasando la clave a React ni alterando el propósito SSA.

La composición access validado → DeviceProof → allocator 011/012 → claims RBAC
canónicos → CentralSessionAssertionIssuer → session.activate todavía no está
montada. `authorization_policy_version_id` y los grants efectivos no se fabrican.
No existe usuario autenticado en el POS por este incremento.

## Pruebas observadas en este Windows

```powershell
$env:POSTGRES_TEST_URL='postgresql://postgres@127.0.0.1:55433/pos_target_test'
pnpm --filter @pos-platform/central-authority exec vitest run tests/business-access-preparation-physical.test.ts -t 'HTTPS commercial'
```

Último resultado: **10 aprobadas / 85 omitidas por filtro / 0 fallidas**,
PostgreSQL temporal y solicitudes HTTPS reales. Resultado anterior de 9/9 quedó
ampliado por recuperación de CSRF. Tras añadir las comprobaciones JWT/refresh y
tenant/UTF-8 se ejecutaron también los filtros afectados: 1/1 y 2/2. No se
repitieron las 70 históricas, MFA ni Argon2id. Log final:
`artifacts/auth-http/2026-10-22/https-final-native-recovery.log`.

```powershell
pnpm --filter @pos-platform/central-authority exec vitest run tests/android-native-registration-artifacts.test.ts tests/native-authorization-constraints.test.ts tests/native-authorization-callback.test.ts tests/commercial-native-client-catalog.test.ts tests/commercial-token-http-contract.test.ts tests/native-authorization-code-exchange.test.ts
pnpm --filter @pos-platform/pos-desktop exec vitest run tests/native-business-login.test.ts tests/native-business-code-transport.test.ts
```

**26/26** Central y **11/11** desktop. Desktop: 6 pruebas del callback con socket
real y 5 del cliente token con HTTPS real. En estas últimas sólo se inyectan DNS
y CA del nombre reservado .test; el servidor es un fixture de respuestas, **no**
Central Authority ni prueba de autenticación humana. Se rechazan redirects,
certificado no confiable, timeout, formato/tamaño/cache y campos adicionales.

```powershell
pnpm --filter @pos-platform/pos-desktop exec esbuild src/electron-business-login.ts --bundle --platform=node --format=esm --external:electron --outfile=dist/native-business-custody-probe.mjs
pnpm --filter @pos-platform/pos-desktop exec playwright test --config e2e/playwright.config.ts e2e/native-custody.spec.ts
```

**1/1** con Electron real, sin cargar el POS, DB o identidad instalada. Se usaron
credenciales de fixture sólo para probar custodia; no se declararon access válidos.
Primer intento falló por timeout: await de nivel superior impedía completar el
arranque supervisado. Se corrigió el entry y se indicó el binario Electron fijado.

```powershell
docker run --rm --env GRADLE_USER_HOME=/tmp/auth-gradle --mount 'type=bind,source=C:\Proyectos\pos-platform\apps\pos-android,target=/work' --workdir /work gradle:8.14-jdk17 sh -lc 'cp -a /work/build/gradle-home /tmp/auth-gradle && gradle --no-daemon --max-workers=2 --project-cache-dir /tmp/auth-project-cache nativeAuthContractsTest runtimeHostJar'
```

**11/11 JVM**, BUILD SUCCESSFUL. No Android real, HTTP DAL real ni Keystore Android
nuevo probados. El primer intento de Gradle falló al renombrar caché inmutable en
el bind mount Windows; se usa una copia en el filesystem temporal del contenedor,
sin borrar caché/firmante existentes. El empaquetador runtime aplica esa corrección.

```powershell
powershell -NoProfile -File apps/pos-android/build-runtime-probe.ps1 -KitDirectory artifacts/android-hardware/mi-kit
docker run --rm --mount 'type=bind,source=C:\Proyectos\pos-platform\apps\pos-android,target=/work,readonly' gradle:8.14-jdk17 python3 /work/verify-runtime-apk.py /work/build/runtime-apk/camacho-node-runtime-probe.apk /work/build/runtime-assets
```

BUILD SUCCESSFUL; APK_VERIFIED minSdk=28, v2=true; **114 assets** verificados,
sin material privado de firma en el APK. Sólo FOREGROUND_SERVICE en permisos;
debuggable/backup/cleartext siguen deshabilitados. No se instaló el APK.
Avisos conservados: D8 indicó java.lang.Object ausente en el classpath de librería
al desugar la nueva Activity; compilación y firma completaron, sin elevar a
compatibilidad runtime. El firmador Java también informó uso de API obsoleta.

APK local: `apps/pos-android/build/runtime-apk/camacho-node-runtime-probe.apk`.
SHA-256: `6cf680bd87138d5aa5ae098dd39e8f569046d5a642a1f868da11ecd2ceb9c6b1`.
Firmante lab público: `92ca6262bd95d0d301e812da8a499f2949051b4c0164f638aef6459f9480b208`.
No se modificó la clave. Log: `artifacts/auth-http/2026-10-22/android-native-auth-apk.log`.

TypeScript de contracts, central-authority y ambos proyectos desktop: exit 0;
database-postgres/target-migrations ya aprobados en el incremento anterior sin
nuevos cambios. Se corrigen dos fixtures que usaban undefined en propiedades
opcionales con exactOptionalPropertyTypes, sin relajar tsconfig.
Arquitectura: 16/16 y ARCH-003 PASS. El detector de secretos rechazó tres JWT
literales de fixture; se sustituyeron por valores efímeros generados durante las
pruebas y se repitieron las afectadas. No se modificó el detector ni su política.

## Externos y publicación

No hay autoridad externa confirmada, dominio/RP/origen reales, registros nativos
aprobados, firmante Android productivo/DAL verificado ni confianza DEV-003.
Continúan las decisiones SEC-004/D3/DEC-025 y políticas explícitas de la propuesta.
La aprobación no sustituye el código y pruebas finales de composición indicados.

CI de `114b8812`: [run 39822028702](https://github.com/Andresito202/pos-platform/actions/runs/39822028702),
falló **antes de iniciar el job**, sin steps: GitHub informó pagos recientes
fallidos o límite de gasto insuficiente. No es CI verde ni un fallo de pruebas
ejecutadas; requiere intervención del administrador de facturación. El SHA de
este segundo incremento se verificará tras publicar. Mantener PR #96 draft,
sin merge a main ni declaración de login comercial completo.

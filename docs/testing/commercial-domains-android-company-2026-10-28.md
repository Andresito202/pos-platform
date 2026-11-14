# Destinos comerciales, Android y contratos empresariales

Base: `c3b12293c244ee54496759dfcfa4028e41345e28`, rama `feat/android-commercial-runtime`; árbol inicial limpio, remoto coincidente. Sin DNS, contratación, despliegue, Actions, merge ni cambios en `oracleJdk-27`. Se usan los dominios elegidos por el propietario; **no están activos ni certificados**.

## Rutas preparadas

| Destino | Montaje preparado | Estado real |
|---|---|---|
| `https://camachoposcolombia.com/` | Build de precios existente y lector PostgreSQL canónico | Opt-in; sin servidor público |
| `/login` en ese origen | Sólo redirige al login Central con selector `request` nativo exacto; no permite `return_to` ni cookies | Sin solicitud vinculada devuelve 503 |
| `/app` en ese origen | Devuelve `WEB_POS_RUNTIME_NOT_PROVISIONED` | POS web bloqueado; no es un dashboard funcional |
| `https://central.camachoposcolombia.com/v1/commercial/login` | Ceremonia existente, sin reconstrucción | Requiere provisión y solicitud firmada por dispositivo |
| `https://central.camachoposcolombia.com/android/callback` | Destino canónico preparado | 503 hasta integración nativa autorizada |
| `https://central.camachoposcolombia.com/.well-known/assetlinks.json` | Productor de metadatos preparado; publicación deshabilitada | 503, ninguna asociación productiva activa |
| `https://central.camachoposcolombia.com/v1/webhooks/factus-pay/collections` | Handler e inbox existentes | URL futura exacta, sin `?key=`; portal sin configurar |

`CamachoCommercialDomains` es la fuente compartida de destinos TypeScript; no es una autoridad de identidad ni una aprobación de infraestructura. El sitio público usa GET sin credenciales y el catálogo existente sobre PostgreSQL. Las rutas GLOBAL, BUSINESS y privadas no se enrutan desde ese host. No hay CORS de autenticación, cookies compartidas, tokens en frontend ni otro backend.

## Provisión del sitio, cuando exista infraestructura autorizada

`CENTRAL_AUTHORITY_ORIGIN=https://central.camachoposcolombia.com` en la configuración de despliegue existente. El montaje opcional `CENTRAL_PUBLIC_SITE_PROVISION_FILE` apunta a un archivo administrado que satisface `CommercialPublicSiteProvisionSchema`:

- `profile: CAMACHO_PUBLIC_SITE_PREPARATION_V1`.
- `origin: https://camachoposcolombia.com` y `central_origin: https://central.camachoposcolombia.com`.
- `renderer_directory`: ruta absoluta al build Desktop que contiene `pricing.html` y assets.
- `maximum_asset_bytes`, `limits.requests`, `limits.buckets`, `limits.windowMs`: valores explícitos del operador, sin defaults productivos nuevos.
- `catalog_migration_checksum`: SHA-256 auténtico de 023, contrastado con el ledger.

Este montaje reutiliza el listener Central; requiere que su certificado cubra ambos hosts, además de la validación TLS Central existente. No acepta un host público mediante un header proxy ni desactiva hostname validation. El operador debe configurar DNS, certificado y puerto accesible después de la compra/autorización. Sin archivo no se monta ningún host nuevo.

## Login web: límite comprobado

El despliegue BUSINESS actual exige un selector `request` de la solicitud nativa previamente registrada mediante DeviceProof, dispositivo y PKCE. Visitar una URL de login sin esa solicitud no crea una sesión. El navegador público no dispone de la custodia del dispositivo y no puede suplantar Electron main/Service.

Se preparó navegación exacta hacia la misma ceremonia Central para una solicitud ya vinculada. **El login web autónomo sigue bloqueado.** Para abrirlo se necesita un contrato de cliente web/runtime, origen, posesión y permisos coherente con D3/DEC-025; no se reutiliza un `client_id` Electron ni se elimina el binding para aparentar acceso. El botón «Iniciar sesión» existe, pero no significa que un visitante sin runtime aprovisionado pueda autenticar y operar.

## Android: reutilización y pendientes concretos

Se conserva el motor Node/Bionic y SQLite existentes, Keystore de laboratorio, Service no exportado y PKCE/App Link existente. `AndroidNativeRegistration.camacho(...)` prepara origen y callback exactos a partir de clientId, paquete y fingerprint aportados por el operador; no genera una identidad.

`prepareAndroidAssociation` comprueba la huella SHA-256 del certificado X.509 aportado contra el registro Android existente y rechaza paquetes probe/debug/lab. Produce sólo metadatos `NOT_PUBLISHED`. La herramienta real es:

```powershell
pnpm --filter @pos-platform/central-authority exec tsx src/prepare-android-app-links-cli.ts --provision <ruta-absoluta-json> --output <ruta-absoluta-nueva-assetlinks.json>
```

El JSON contiene exactamente `registration` (contrato Android existente: clientId, platform ANDROID, authorizationOrigin, redirectUri, androidPackageId, androidSigningCertificateSha256) y `signing_certificate_file` (ruta absoluta al certificado auténtico exportado del APK release). La salida no sobrescribe archivos ni se publica automáticamente. No se eligió un packageId comercial ni un fingerprint ficticio. Su coincidencia con un certificado no prueba por sí sola que ese APK haya sido aprobado o instalado.

**No hay APK comercial disponible.** Faltan:

1. Paquete release y firma auténticos, política SEC-004/DEC-025 Android y DEV-003 del dispositivo.
2. Integrar el enlace de solicitud nativa firmado antes del navegador: el helper Android actual todavía construye la variante antigua de URL PKCE, mientras el despliegue V2 exige `?request=`. No se declara esa variante antigua utilizable en producción.
3. Canje nativo con DeviceProof fresca, custodia access/refresh, recepción/verificación SSA/SAS y permisos en el host Android. La composición Central de despliegue sigue validando una inscripción Electron; registrar Android requiere su composición aprobada, no cambiar sólo un nombre.
4. Canal React↔Service Android autenticado y renderer con carga por permisos, usando el motor existente. El probe no contiene React ni un POS completo.
5. Manifest release, permiso de red y App Link verificado; el manifest probe conserva callback no exportado, sin filtro productivo ni permiso de Internet añadido por esta misión.
6. Reanudación, offline autorizado y sincronización de negocio con confianza real; las pruebas previas de SQLite/WAL no certifican esas operaciones comerciales.
7. Instalación y prueba física posterior. No se actuó sobre impresora/cajón ni se alteraron sus adaptadores.

## Contratos privados y renovaciones

`readCompanyLicenseContracts` implementa una proyección interna dentro de una transacción previamente autorizada, con tenant derivado del contexto RLS y empresa contrastada en PostgreSQL. No recibe tenant del cliente. Correlaciona licencia con cotización y pago confirmado; devuelve modalidad, versión, importe histórico, caja incluida/adicionales pagadas, vigencia/gracia y soporte contratado. No interpreta el precio público vigente como precio de un contrato anterior.

No es una nueva autoridad de autenticación ni está montada como HTTP/IPC: faltan el permiso empresarial canónico de lectura y una operación de posesión específica para ese transporte. No se presta el permiso GLOBAL `LICENSE_PLAN_MANAGE` a un usuario BUSINESS. La vista empresarial de precios públicos continúa separada de esta información privada. Los contratos antiguos sin empresa demostrable a través de su fuente financiera no se atribuyen por inferencia a una empresa.

La lectura calcula vigencia/gracia sólo con `LicenseActivationPolicySchema` explícita y política de contrato aceptada; el tiempo proviene del servidor. No modifica fechas ni derechos. El soporte vencido no caduca el uso perpetuo. `renewalStatus` mantiene el requisito de pago confirmado/términos aprobados.

El historial de activaciones distingue asignaciones emitidas de la cantidad de cajas pagadas; un registro ACTIVE no sustituye la validación actual de firma, dispositivo y revocación del gate Windows. Esta proyección no concede acceso al cajero.

**Renovación comercial no cerrada:** los componentes actuales emiten un contrato por pago, pero no existe en el esquema inspeccionado una relación canónica de sucesión entre contrato previo y renovación. Deben definirse continuidad, fecha de inicio, vínculo financiero y tratamiento del soporte antes de publicar una mutación; no se inventaron una tabla, precio, prorrateo ni extensión gratuita. Tampoco se confunde cantidad de dispositivos con cajas.

## Evidencia de este incremento

Pruebas focalizadas de destinos/redirect, asociación y digest real sobre certificado efímero de test, JVM Android, HTTPS temporal con hosts oficiales resueltos únicamente por conexión loopback de prueba y PostgreSQL aleatorio temporal. Nunca DNS real ni servicios externos.

La integración de contrato privado prueba falta de contexto confiable, empresa ajena y lectura del contrato pagado conservando sus importes/versiones. Publicación y ceremonia Electron se ejercitan sólo como predecesores necesarios del escenario modificado; no se repiten suites generales de contraseña, MFA, ventas o hardware.

Los certificados y usuarios de fixture no acreditan despliegue ni persona. Las pruebas de Android son JVM, sin instalación ni verificación App Links por el sistema operativo. FACTUS Pay conserva su custodia/webhook y no se llamó al proveedor ni se modificaron tokens.

La [guía oficial Android de verificación](https://developer.android.com/training/app-links/verify-applinks) distingue la comprobación del sistema operativo de la lectura de metadatos. Para el M60WL Android 9, no se atribuyen comandos de verificación propios de Android 12 a ese dispositivo ni se fuerzan asociaciones manuales como si fueran verificadas.

### Comandos y resultados observados

```powershell
$env:POSTGRES_TEST_URL='postgresql://postgres@127.0.0.1:55433/postgres'
pnpm --filter @pos-platform/central-authority exec vitest run tests/subscription-quotes-physical.test.ts tests/android-association-preparation.test.ts -t 'FACTUS API:|GLOBAL:|Android candidate' --reporter=json --outputFile=../../artifacts/licensing/2026-10-28/domains-company-final.json
pnpm --filter @pos-platform/central-authority exec vitest run tests/company-license-term.test.ts
pnpm --filter @pos-platform/central-authority exec vitest run tests/android-association-preparation.test.ts
pnpm --filter @pos-platform/contracts exec vitest run tests/commercial-domains.test.ts
pnpm --filter @pos-platform/central-authority typecheck
pnpm --filter @pos-platform/contracts typecheck
pnpm --filter @pos-platform/pos-desktop typecheck
pnpm --filter @pos-platform/pos-desktop run build:renderer
node tools/architecture/validate-boundaries.mjs
```

- Integración final: 3 PASS / 0 FAIL / 5 filtrados. El escenario FACTUS API es un doble TLS controlado, predecesor necesario de la prueba GLOBAL; no una llamada al proveedor.
- Vigencias de lectura: 8 PASS, límites exactos de gracia, suspensión/cancelación y perpetua.
- Asociación y CLI: 2 PASS; certificado efímero exclusivo de test, rechazo de fingerprint incorrecto/probe, archivo nuevo y no sobrescritura.
- Destinos: 1 PASS. No sumar la prueba de asociación repetida en dos comandos como casos distintos.
- TypeScript Central/Contracts/Desktop, build renderer y arquitectura: PASS. Service Windows, preload y sus protecciones no cambiaron.
- JVM Android: `nativeAuthContractsTest`, 12/12 PASS, build Gradle offline exitoso. Se usó la imagen existente `gradle:8.14-jdk17` y cache ya disponible, sin APK ni instalación:

```powershell
docker run --rm --env GRADLE_USER_HOME=/tmp/camacho-auth-gradle --mount "type=bind,source=C:\Proyectos\pos-platform\apps\pos-android,target=/work" --workdir /work gradle:8.14-jdk17 sh -lc 'if [ -d /work/build/gradle-home ]; then cp -a /work/build/gradle-home /tmp/camacho-auth-gradle; fi; gradle --offline --no-daemon --max-workers=2 --project-cache-dir /tmp/camacho-domains-cache nativeAuthContractsTest'
```

Fallos conservados: import Zod inicialmente no declarado en Central, corregido moviendo el esquema al paquete Contracts que ya declara la dependencia; sin instalar otra. La primera ceremonia Electron devolvió 400 mientras compilaba Android (`domains-company.json`); la ejecución serial y final pasaron. La causa del 400 no quedó demostrada, no se modificó ni relajó autenticación y no se elimina esa evidencia.

**Cierre:** preparación implementada/probada localmente. Dominios/HTTPS sin provisión; login web autónomo bloqueado; Android comercial y consulta privada de producto/renovaciones aún requieren los contratos y componentes detallados arriba. No hay certificación humana ni productiva. PR #96 permanece Draft; CI no ejecutado por orden del propietario.

### Huellas de evidencia local

- `domains-company-final.json`: `20892a53b24b9612c9257f74045be0b9f648e520a19e33ff27055a3dd129b8ad`
- `domains-company-serial.json`: `5e8756245e2fd248f8d0ed88b3038fd4c8ac14b03b0252eb90e6441f096f8bd4`
- `domains-company.json`: `f7ff077fb8d4e87224d20cacdd06d18b856fd7fed412dd4c032c8cb257e0976a`
- `company-terms.json`: `632bdd3be41940ab4edf98c48d501aec5dfd00297ae70f36a5c98a666e50070c`
- `android-association-cli.json`: `94e24a939734d078aa9e8b2c490614d226c01fb22ace9dc1e08fccc50d48a878`
- `domain-contracts.json`: `159f6f06df80e7a4d861c2218f2925eef85ad82418fba587434da5ae745e6b5f`

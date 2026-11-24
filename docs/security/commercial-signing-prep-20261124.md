# Prep de firma comercial Windows / Android (sin claves privadas en Git)

## Regla

Nunca generar, committear ni publicar claves privadas de Central, SSA, SAS, Device Trust, Authenticode o Play en este repositorio.

## Windows (Authenticode)

| Ítem | Estado |
|---|---|
| electron-builder `signAndEditExecutable` | Configurado; requiere certificado externo |
| RT-009-B Authenticode | **BLOCKED** hasta certificado comercial Camacho |
| Electron Fuses + ASAR integrity | Remediado en esta fase (policy + electron-builder.yml) |
| Almacén de certificado | HSM/proveedor externo; path de firma sólo en entorno de release |

## Android

| Ítem | Estado |
|---|---|
| PKCS12 lab `camacho-android-test.p12` | Sólo laboratorio; no Play |
| Fingerprint DAL | Prep `NOT_PUBLISHED` en PR #136 |
| Play App Signing | Fuera de alcance lab; upload key / Play Console fuera de Git |
| Firma release | Operador suministra keystore fuera del árbol; CI usa secret store |

## Procedimiento de release (futuro)

1. Operador carga certificado/keystore en secret manager (no chat, no Git).
2. Pipeline firma artefactos en runner aislado.
3. Publica únicamente digests + fingerprint público.
4. Verifica `apksig` / Authenticode sobre el artefacto firmado.
5. Registra SHA + HEAD exacto en evidencia de release (SEC-G10).

# Prep de privatización de repositorios (sin cambiar visibilidad)

Fecha: 2026-11-24 · Fase seguridad integral.

## Estado observado (GitHub API)

| Repositorio | Visibilidad actual | Acción ahora |
|---|---|---|
| `Andresito202/pos-platform` | **public** | Ningún cambio de visibility |
| `Andresito202/camacho-pos-comercial` | **public** | Ningún cambio de visibility |

Esta fase **documenta** exposición y checklist. No ejecuta `gh repo edit --visibility private`.

## Exposición relevante

- Código de dominio, contratos, Central Authority, Electron, Android lab, migrations.
- Documentación de seguridad y gates (`SEC-G01..G10`).
- **No** deben existir claves privadas de Central/SSA/SAS/Device Trust en Git (política vigente).
- APKs de lab y PKCS12 de prueba no son firma Play/Authenticode comercial.

## Checklist antes de privatizar (futuro autorizado)

1. Inventario de forks/clones conocidos y colaboradores.
2. Rotación de cualquier secreto que hubiera podido filtrarse históricamente (aunque la política prohíba privados en Git).
3. Confirmar CI/secrets GitHub Actions siguen disponibles tras private.
4. Confirmar dependencias de submódulos/paquetes públicos no rompen consumo interno.
5. Comunicar a operadores el cambio de URL/acceso.
6. Orden expresa del propietario + verificación post-cambio.
7. Mantener evidencia histórica de PRs públicos si se archiva.

## Residual

Mientras ambos repos sean públicos, el código es legible por terceros. Mitigación actual: fail-closed runtime, Device Trust, SSA/SAS, licencias firmadas, ausencia de privados en Git. Privatización reduce superficie de ingeniería inversa de código, no sustituye controles criptográficos.

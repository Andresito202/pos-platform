# Gate de compatibilidad de licencias

TECH-004 Bloque 4 evalúa todos los componentes third-party del SBOM CycloneDX, no solo los paquetes instalados en Linux.

Fuentes: primero `dependency-inventory.json`; para componentes SBOM-only consulta nombre+versión exactos en `https://registry.npmjs.org/`. Error de registry, identidad distinta, licencia ausente o expresión inválida produce `REVIEW_REQUIRED` y bloquea.

La policy `tools/ci/license-compatibility-policy.json` usa tres estados: `ALLOW`, `REVIEW_REQUIRED`, `DENY`. El parser entiende paréntesis, `AND`, `OR` y `WITH`. `MIT OR GPL-3.0-only` puede usar la alternativa MIT; `MIT AND GPL-3.0-only` queda DENY. IDs desconocidos y excepciones WITH no revisadas requieren review.

El piso DENY para AGPL/GPL/SSPL/BUSL/UNLICENSED no puede rebajarse por configuración. MPL-2.0 se acepta como policy de ingeniería con obligaciones explícitas; esto no constituye opinión jurídica sobre una distribución futura.

PASS exige inventory ⊆ SBOM, cobertura de todos los third-party, 0 DENY y 0 REVIEW_REQUIRED.

Evidencia: `license-compatibility-report.json` + SHA-256, ligados a reviewed SHA, digest del SBOM, inventory y policy. Artifact exact-head retenido 90 días. No autoriza merge, runtime, release ni producción.

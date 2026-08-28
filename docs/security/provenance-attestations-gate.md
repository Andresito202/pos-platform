# Gate de provenance y attestations

## Alcance

TECH-004 Bloque 5 demuestra qué source exacto produjo la evidencia de calidad y supply chain de un run TARGET.

El control materializado es **provenance verificable por hashes y metadatos de GitHub Actions**. No se presenta como firma criptográfica ni como GitHub Artifact Attestation nativa.

## Fuentes obligatorias

El job `Provenance evidence` depende de los jobs TARGET de supply chain y validación ejecutable. Después:

1. obtiene por API los artifacts del mismo `GITHUB_RUN_ID`;
2. exige exactamente un artifact exact-head para TARGET, inventory, vulnerabilidades, SBOM y licencias;
3. espera el workflow CodeQL del mismo reviewed SHA y exige conclusión `success`;
4. obtiene exactamente `codeql-sarif-<reviewed_sha>`;
5. conserva artifact ID, workflow run ID y digest reportado por GitHub;
6. valida rutas del ZIP antes de extracción y rechaza entradas no regulares durante la validación de evidencia;
7. vuelve a validar el SHA interno declarado por TARGET/inventory/vulnerability/SBOM/license.

La colección falla cerrado si falta un artifact, hay más de uno con el nombre exacto, un run no corresponde al SHA, CodeQL no termina verde dentro de la ventana o la evidencia no puede validarse.

## Manifest

`artifacts/ci/provenance-manifest.json` usa:

`pos-platform-provenance-manifest/v1`

y liga:

- repository;
- commit exacto;
- branch/ref/event;
- TARGET workflow, run ID y attempt;
- CodeQL run ID;
- Node y pnpm;
- versión + SHA de CodeQL Action;
- versión + SHA de upload-artifact;
- SHA-256 de `pnpm-lock.yaml`;
- TARGET exact-head evidence;
- dependency inventory;
- vulnerability report y raw audit;
- CycloneDX SBOM;
- license compatibility report;
- SARIF agregado;
- artifact names, IDs, workflow run IDs y digests reportados por GitHub.

También se emite:

`artifacts/ci/provenance-manifest.json.sha256`

y el índice de fuentes:

`artifacts/ci/provenance-source-index.json`.

## Validación de tamper

Las regresiones prueban como mínimo:

- mismo input → manifest determinista;
- modificación de un archivo fuente → FAIL;
- sustitución del digest/metadata de un artifact → FAIL;
- artifact fuente ausente → FAIL.

SBOM y license report deben coincidir además con sus checksums companion antes de incorporarse al manifest.

## Retención

Los artifacts que alimentan provenance se retienen 90 días, incluido dependency inventory, para evitar que una fuente expire antes que el manifest que la referencia.

## GitHub native Artifact Attestations

Estado vigente:

`GITHUB_NATIVE_ATTESTATION = BLOCKED_BY_PLATFORM`

Razón registrada:

`PRIVATE_REPOSITORY_ENTERPRISE_CLOUD_PREREQUISITE_NOT_ESTABLISHED`

GitHub documenta que las attestations para repositorios privados/internos requieren GitHub Enterprise Cloud; no existe evidencia en este repositorio de que ese prerrequisito esté habilitado. Por tanto TECH-004 no añade `id-token: write`, no llama a `attest-build-provenance` y no inventa un PASS nativo.

Si el repositorio migra a una configuración compatible, habilitar attestations será un cambio separado que deberá obtener evidencia exact-head nueva.

## Limitaciones

El manifest hash-bound:

- detecta sustitución/tamper respecto de las fuentes descargadas y de los metadatos consultados;
- no añade por sí mismo identidad firmada externa;
- no reemplaza firma de releases;
- no constituye provenance de un binario/runtime aún inexistente;
- no autoriza merge, runtime ni producción.

TECH-004 puede cerrar Bloque 5 con este control y registrar la attestation nativa como bloqueo de plataforma explícito, no como PASS.

# Gate SBOM CycloneDX

## Alcance

TECH-004 Bloque 3 materializa un Software Bill of Materials interoperable para el grafo resuelto reportado por pnpm en CI. El documento emitido usa CycloneDX JSON 1.6 y queda ligado al HEAD revisado y al lockfile.

No es una attestación firmada, una conclusión legal de licencias ni evidencia de un runtime todavía inexistente.

## Fuente del grafo

El generador ejecuta:

`pnpm list --json --recursive --depth Infinity`

después de `pnpm install --frozen-lockfile`. Cruza ese grafo con el discovery compartido de manifests:

- `package.json`;
- `apps/*/package.json`;
- `packages/*/package.json`;
- `tools/*/package.json`.

Esto evita convertir el inventario plano de dependencias en una relación artificial. El inventario sigue siendo evidencia complementaria; el SBOM conserva relaciones padre-hijo reales del grafo reportado por pnpm.

## Contrato emitido

El archivo `artifacts/ci/bom.cdx.json` contiene:

- `bomFormat = CycloneDX`;
- `specVersion = 1.6`;
- componente raíz;
- todos los workspaces descubiertos como first-party;
- dependencias third-party resueltas con versión exacta;
- PURL npm canónica como `bom-ref`;
- una entrada de relaciones para cada componente;
- repositorio;
- SHA exacto revisado;
- `pnpm@9.15.0`;
- SHA-256 de `pnpm-lock.yaml`;
- identidad y versión del generador.

Las dependencias `link:` se resuelven al componente first-party correspondiente y no crean componentes ficticios. El componente raíz enlaza todos los workspaces sin autorreferencia.

## Determinismo e integridad

El generador no incorpora timestamp ni UUID aleatorio. Ordena componentes, relaciones y destinos antes de serializar. Para el mismo source, lockfile y grafo produce los mismos bytes.

Se emite además:

`artifacts/ci/bom.cdx.json.sha256`

El digest protege el artifact en tránsito y será una entrada del Bloque 5 de provenance. Por sí solo no constituye firma ni attestación.

## Validación fail-closed

El generador y su suite rechazan:

- SHA fuente no exacto;
- digest de lockfile inválido;
- root manifest ausente;
- workspace declarado con dependencias pero ausente del grafo pnpm;
- dependencia sin versión exacta;
- dependencia `link:` que no resuelve a un workspace;
- PURL o `bom-ref` incompletos;
- componentes duplicados;
- relaciones duplicadas o colgantes;
- componente sin entrada de relaciones;
- cobertura incompleta de workspaces;
- grafo third-party vacío;
- ciclos que no terminan.

La validación estructural es ejecutable y específica del contrato del proyecto. La compatibilidad formal con herramientas externas se expresa mediante CycloneDX 1.6; este bloque no introduce una dependencia nueva solo para validar el schema.

## CI y evidencia

El job `supply-chain-baseline`:

1. ejecuta las regresiones del generador;
2. instala con lockfile congelado;
3. ejecuta vulnerability audit;
4. genera y valida el SBOM;
5. ejecuta el gate SPDX sobre el universo third-party del SBOM;
6. publica `cyclonedx-sbom-<reviewed_sha>` por 90 días.

El artifact es commit-scoped. Cualquier cambio de HEAD invalida el PASS anterior.

## Límites deliberados

- El SBOM conserva el grafo reportado por `pnpm list`; ese grafo puede incluir dependencias opcionales específicas de otras plataformas que no aparecen como paquetes materializados en el inventory Linux. El inventory instalado debe ser subconjunto del SBOM y Bloque 4 resuelve metadata de licencia para componentes SBOM-only por nombre+versión exactos.
- Licencias y expresiones SPDX se evalúan en el Bloque 4 mediante `docs/security/license-compatibility-gate.md`.
- Provenance y attestations se materializan en el Bloque 5.
- La evidencia no autoriza merge, runtime, release ni producción.

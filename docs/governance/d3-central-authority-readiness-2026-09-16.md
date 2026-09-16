# D-3 — Preparación de autoridad central — 2026-09-16

## Estado

`READINESS / ARCHITECTURE PACKAGE MATERIALIZED`

D-3 sigue siendo el siguiente objetivo técnico después de D-2. No se ha creado todavía una autoridad central productiva ni se ha convertido el persistence gate en runtime de producto.

La ambigüedad principal de D-3 — la raíz de confianza y el bootstrap de dispositivo — ya está convertida en una propuesta arquitectónica concreta en:

`docs/architecture/dec-022-trust-bootstrap-proposal-2026-09-16.md`

La propuesta continúa explícitamente `PROPOSED / NOT RATIFIED`; documentarla no equivale a ratificarla.

## Evidencia existente

La línea activa ya contiene un servidor ejecutable de validación/persistence gate en `tools/target-migrations/src/central-sync-server.ts`. Ese servidor demuestra una base técnica reutilizable:

- PostgreSQL mediante `pg`;
- `CENTRAL_SYNC_TOKEN` fail-closed;
- validación de request/response mediante contratos compartidos;
- límite de operaciones y body;
- checksum SHA-256 del payload canónico;
- persistencia transaccional en `sync.sync_operations`;
- contexto `app.tenant_id` antes de acceso a datos;
- comprobación durable posterior al commit;
- replay por `operation_id` con comprobación de checksum e identidad;
- idempotencia por `(tenant_id, operation_type, idempotency_key)`;
- respuesta `COMMITTED` sólo después de evidencia durable.

Ese servidor sigue siendo **evidencia de gate**, no runtime productivo.

## Arquitectura D-3 ya delimitada

La propuesta de DEC-022 establece como candidato arquitectónico:

```text
artefacto firmado
  ↓ contiene trust anchor público
root DEVICE_TRUST
  ↓ autoriza
operational DEVICE_TRUST key
  ↓ autentica
credencial/attestation del dispositivo
  ↓ binding
installation_id + device_id + tenant/company
  ↓
Central Authority
```

La private key del dispositivo se genera localmente y no se transmite. Un token de transporte no constituye la raíz de confianza. Restore o clonación de archivos no equivale automáticamente a un dispositivo confiable.

Esto reutiliza la separación de propósitos ya establecida por SEC-004 y la maquinaria criptográfica existente, en vez de crear una segunda familia criptográfica.

## Gaps concretos restantes

1. **Ratificación humana de DEC-022.**
2. **Contrato de enrollment:** formato exacto y lifecycle de la activación inicial.
3. **Registro central de devices:** modelo de persistencia y ownership dentro de `Devices`.
4. **Autenticación de frontera:** middleware/puerto que valide TLS + evidencia de device trust + binding + revocación.
5. **Runtime propietario:** aplicación Central Authority separada del persistence gate.
6. **Secret management:** selección verificable de KMS/HSM/secret manager para producción.
7. **Despliegue:** límites entre API, worker, PostgreSQL y componentes administrativos.
8. **E2E de seguridad:** enrollment, autenticación, revocación, rotación, restore/clone denial y fail-closed.

## Lo que ya NO está ambiguo

No se debe volver a abrir por preferencia:

- Ed25519 como mecanismo criptográfico base;
- separación por `key_purpose`;
- private key de dispositivo fuera del servidor;
- renderer/preload sin secretos de infraestructura;
- backup sin identidad privada de dispositivo;
- token de transporte distinto de trust anchor;
- una sola autoridad de persistencia central;
- reutilización de contratos e invariantes del persistence gate;
- ownership por módulos existente.

El mapa de módulos mantiene `Devices`, `Authorization`, `Licensing`, `Audit` y `Sync` como owners distintos, y los componentes de ejecución no crean dominios adicionales. fileciteturn107file0L2-L2

## No hacer

- No copiar `central-sync-server.ts` a otra carpeta para aparentar D-3.
- No crear otro endpoint paralelo de sync.
- No introducir snapshots/SSA/SAS como sustitución de la autoridad de escritura.
- No inventar credenciales en `.env`, código fuente o fixtures productivos.
- No ratificar DEC-022 implícitamente mediante implementación.
- No cambiar DEC-008, DEC-010, contratos de sync u ownership para facilitar la implementación.

## Entrada a implementación

D-3 podrá pasar a implementación cuando DEC-022 sea ratificada y queden fijados, como mínimo:

```text
trust anchor
→ device credential
→ enrollment
→ central authentication
→ device registry
→ persistence ownership
→ replay/idempotency
→ deployment boundary
```

La implementación deberá reutilizar contratos e invariantes ya demostradas, no reconstruirlas.

## Relación con D-2

D-2 continúa pendiente de ejecución real del persistence gate. La imposibilidad actual de GitHub Actions por el bloqueo de billing no se transforma en PASS ni FAIL de código.

```text
D-2 = TESTED / runtime evidence pendiente
D-3 = READINESS / architecture package materialized
DEC-022 = PROPOSED / NOT RATIFIED
```

## Próximo movimiento de desarrollo

Una vez ratificada DEC-022, el bloque se ejecutará en una sola secuencia, no en microtrabajos desconectados:

```text
1. contratos de trust/enrollment
2. verifier + key-purpose enforcement
3. device identity persistence
4. enrollment service
5. central device registry
6. authenticated central boundary
7. Central Authority runtime
8. persistence/idempotency integration
9. security E2E + mutation/security gates
10. runtime evidence
```

D-2 queda visible como pendiente de ejecución y se cierra cuando exista el artifact/log exigido; no se utiliza como excusa para crear una segunda arquitectura.

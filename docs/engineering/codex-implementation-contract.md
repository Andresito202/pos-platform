# Contrato de implementación para Fase 1

## Propósito

Este documento establece reglas obligatorias para cualquier cambio de implementación o tooling de Fase 1.

Su objetivo es impedir arquitectura paralela, código especulativo, claims falsos, cambios sin trazabilidad, ramas huérfanas y decisiones contradictorias entre documentación y código.

## Autoridad normativa

Antes de modificar código se consulta, en este orden:

1. `docs/product/backlog.md` para estado, prioridad, bloqueo y orden inmediato;
2. ADR/DEC aceptadas;
3. `docs/architecture/module-map.md` y `docs/architecture/data-ownership.md` para límites y ownership;
4. contratos de arquitectura/physical model aplicables;
5. reglas de dominio y casos de uso;
6. security gates aplicables;
7. estrategia de pruebas y contratos de migrations;
8. `docs/governance/repository-governance.md` para ramas, PRs y merge.

Si dos fuentes normativas vigentes se contradicen, el trabajo afectado se detiene y la contradicción se reconcilia antes de implementar. No se resuelve silenciosamente mediante código.

## Estado real antes de editar

Antes de un cambio se debe determinar explícitamente:

- baseline remoto y branch objetivo;
- elemento de backlog asociado;
- alcance exacto;
- artifacts existentes;
- gates aplicables;
- dependencias y bloqueos;
- archivos previstos.

### GitHub remoto vs estado local

GitHub remoto permite afirmar únicamente evidencia remota: refs, commits, PRs, workflows, diffs y configuración que el API exponga.

No se declara desde GitHub remoto:

- working tree local limpio;
- staged/unstaged local;
- upstream local;
- Docker local;
- PostgreSQL local;
- procesos locales;
- pruebas ejecutadas solo en el equipo local.

Sin verificación local actual, esos estados son:

`NOT_EVALUATED / REQUIRES_LOCAL_VERIFICATION`

Un snapshot histórico de estado local no se convierte en un hecho presente.

## Alcance del cambio

1. Cada tarea modifica solo lo necesario para sus criterios de aceptación.
2. No se refactoriza, renombra o reformatea trabajo no relacionado.
3. No se importa una implementación externa/anterior para aparentar que implementa TARGET.
4. No se crean migrations, DDL, providers o runtime cuando el gate aplicable esté bloqueado.
5. No se crea una rama nueva si ya existe una rama activa para el mismo objetivo.
6. No se deja una rama activa sin PR, objetivo vigente o condición de bloqueo documentada.

## Arquitectura

1. TARGET aplica monolito modular, Clean Architecture y Ports & Adapters verificables.
2. `domain` contiene entidades, value objects, invariantes y servicios sin framework, persistencia o provider.
3. `application` contiene casos de uso y puertos; depende de `domain`, no de adaptadores concretos.
4. `infrastructure` contiene persistencia, mensajería, hardware y providers que implementan puertos.
5. Controllers/handlers validan y traducen contratos; no contienen reglas de negocio.
6. El composition root/NestJS ensambla dependencias; el dominio no importa NestJS, React, Electron, Kysely ni drivers.
7. Un módulo no accede directamente a tablas internas de otro módulo.
8. `module-map.md` define bounded contexts. Subcapacidades como Categories, Product Codes, Units o Lots no crean packages propietarios separados.
9. External Integrations y Electronic Invoicing permanecen módulos diferentes con ownership explícito.
10. No se crean microservicios, Kafka, Redis, Kubernetes u otra infraestructura preventiva sin evidencia que lo justifique.

## TypeScript

1. `strict: true`.
2. `any` solo ante necesidad inevitable, localizada y documentada.
3. No se usa `@ts-ignore` para ocultar errores.
4. No se usan type casts para saltar invariantes.
5. Entradas externas se validan en runtime en su frontera.
6. Estados, códigos, permisos y errores críticos usan contratos estables, no magic strings dispersos.
7. Zod u otro schema aprobado valida contratos compartidos cuando TECH-003 los materialice.

## Datos, tenancy e integridad

1. Dinero/cantidades exactas no usan tipos binarios de punto flotante como autoridad.
2. Todo recurso tenant-scoped conserva las identidades exigidas por el modelo.
3. Un `tenant_id` enviado libremente por cliente nunca constituye autoridad.
4. Relaciones tenant/company/branch/device se validan contra contexto autorizado y constraints cuando apliquen.
5. Ninguna caché, idempotency key, evento, snapshot o query puede contaminar tenants.
6. Hechos financieros, inventario, auditoría y evidencia no se reescriben destructivamente cuando el contrato exige append-only/compensación.
7. Idempotencia persiste identidad y evidencia suficiente para reintentos.
8. Timestamps son evidencia, no política genérica de autoridad ni `last-write-wins`.
9. PostgreSQL y SQLite conservan migrations/pruebas físicas separadas.

## Local-first

1. Operaciones críticas conservan `operation_id`, idempotency key, checksum, causalidad y versión esperada.
2. El reloj del dispositivo no es autoridad global.
3. Un timeout no equivale a fallo ni éxito.
4. `UNKNOWN_OUTCOME` requiere consulta/reconciliación antes de retry con efecto externo.
5. Un hash simple no demuestra autenticidad frente a un atacante con control del almacenamiento local cuando el riesgo exige firma/prueba criptográfica.

## Seguridad

1. No se hardcodean secretos, contraseñas, tokens, claves privadas o certificados utilizables.
2. No se incorporan secretos/datos reales en fixtures, docs, logs o snapshots no autorizados.
3. El backend revalida autenticación, tenant, autorización, licenciamiento y reglas críticas.
4. Autenticación, pertenencia, autorización y licencia son decisiones distintas.
5. Se aplica mínimo privilegio.
6. Cambios críticos incluyen pruebas negativas cross-tenant y de escalamiento de privilegios cuando corresponda.
7. `SEC-G01..SEC-G10` permanecen `NOT_EVALUATED` hasta existir evidencia ejecutable suficiente.
8. Un CI verde de tooling no promueve security gates de runtime.

## Migrations

1. Artifacts 001/002 son inmutables después de materialización/revisión.
2. Un down destructivo valida identidad/checksum/historial y dependencias antes de mutar.
3. El ledger es autoridad de ejecución; no se introduce metadata paralela silenciosa.
4. SQL/descriptor 003 no se crean mientras INT-006 esté bloqueado por contradicciones contractuales/revisión pendiente.
5. El WIP histórico SQL003 no se integra ni cherry-pickea completo.
6. Un manifest documental no equivale a SQL, apply, provider integration o cumplimiento normativo.

## Providers e integraciones

1. Providers se implementan detrás de puertos neutrales.
2. DTO/provider status no se convierten en entidades/estados canónicos del dominio.
3. IDs externos viven en mappings definidos; no se añaden columnas `siigo_*`, `factus_*`, `alegra_*` a entidades canónicas.
4. Un provider nunca modifica directamente Sale, Payment, Cash Register, Tax o Inventory.
5. `Connected` no equivale a credencial vigente, capability verificada ni readiness productiva.
6. Mock/sandbox no se presenta como integración productiva.

## Calidad y mantenibilidad

1. No se crean God Services, archivos gigantes o abstracciones especulativas sin necesidad revisada.
2. Cada módulo conserva responsabilidad cohesiva.
3. No se duplican invariantes, autorización, cálculos, normalización o ownership.
4. No se agregan comentarios que solo repitan el código.
5. Errores técnicos usan códigos estables; mensajes libres no son API.
6. Antes de ampliar archivos de tooling grandes se evalúa extraer responsabilidades reales sin crear wrappers vacíos.

## Pruebas

Todo comportamiento nuevo incluye pruebas proporcionales para:

- reglas e invariantes;
- aislamiento multi-tenant;
- autorización;
- idempotencia;
- concurrencia;
- compensación;
- recuperación;
- errores/resultado incierto;
- diferencias de dialecto cuando apliquen.

No se eliminan aserciones ni se modifica una prueba para aceptar comportamiento incorrecto.

Cuando el stack afectado disponga de scripts, la validación mínima incluye:

- tests relevantes;
- typecheck;
- lint cuando exista;
- build cuando exista;
- validaciones de migration por dialecto cuando apliquen;
- revisión del diff;
- CI commit-scoped antes de merge.

No se inventa como ejecutado un comando ausente.

## Commit, push y entrega

No se hace commit/push/merge sin la autorización aplicable al flujo vigente.

La entrega no obliga a afirmar falsamente que no hubo commit o push. Debe reportar el estado real mediante uno de estos formatos:

- `COMMIT_PUSH = NO`;
- `COMMIT_PUSH = YES / AUTHORIZED / branch=<rama> / sha=<sha>`.

Si hubo PR/merge:

- `PR = <número> / estado`;
- `MERGE = YES|NO`;
- `MAIN_AFTER_MERGE = <sha>` cuando aplique;
- CI/reviews se reportan con SHA exacto.

Nunca se dice `CLEAN`, `0/0`, `PASS`, `MERGED`, `PROTECTED` o `PRODUCTION_READY` sin evidencia correspondiente.

## Procedimiento obligatorio

### Antes de editar

1. identificar el item de backlog;
2. verificar baseline remoto y rama;
3. leer fuentes normativas aplicables;
4. buscar implementación/contrato existente para evitar duplicidad;
5. enumerar archivos exactos y justificar alcance;
6. detenerse si existe contradicción normativa o gate bloqueante.

### Durante

1. mantener el cambio acotado;
2. preservar trabajo previo no relacionado;
3. mantener reglas fuera de controllers/adapters;
4. agregar pruebas junto al comportamiento;
5. documentar deuda real sin inventar scope futuro.

### Antes de integrar

Aplicar `docs/governance/repository-governance.md`:

- HEAD exacto;
- base exacta;
- CI del mismo SHA;
- threads/reviews;
- diff final;
- alcance autorizado;
- merge normal con `expected_head_sha`;
- verificación post-merge.

## Entrega final mínima

La entrega debe indicar:

1. archivos creados/modificados;
2. requisito cubierto;
3. invariantes preservados;
4. validaciones reales y resultados;
5. deuda/bloqueos vigentes;
6. contradicciones encontradas y su estado;
7. branch/PR/SHAs aplicables;
8. commit/push/merge real, sin fórmula fija que contradiga los hechos.

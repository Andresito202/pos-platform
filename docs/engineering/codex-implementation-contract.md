# Contrato de implementación para Fase 1

## Propósito y alcance

Este documento establece reglas obligatorias para cualquier cambio de implementación de Fase 1. Complementa el backlog, las decisiones ADR/DEC y los contratos de arquitectura, dominio, seguridad y casos de uso; no los sustituye ni autoriza por sí mismo trabajo que el backlog mantenga bloqueado, planificado o fuera de alcance.

El repositorio conserva una línea base heredada en FastAPI, SQLAlchemy, Alembic y HTML/JavaScript. El stack objetivo aprobado por `ADR-005` utiliza TypeScript estricto, Node.js, NestJS, pnpm, Nx, Kysely, PostgreSQL y SQLite. Las reglas del stack objetivo no declaran materializado ese esqueleto ni autorizan migraciones, DDL o adaptación silenciosa del legado.

Antes de modificar código se debe comprobar la rama, el estado Git, el trabajo vigente del backlog, sus dependencias, los artefactos existentes y las fuentes normativas aplicables. No se duplica un concepto ya existente ni se adelanta una capacidad no autorizada.

Si dos fuentes normativas se contradicen, el trabajo se detiene y se informa la contradicción con archivo, sección, alternativas y efecto. No se resuelve arbitrariamente mediante código.

## Autoridad normativa y alcance del cambio

1. `docs/product/backlog.md` determina orden, estado, prioridad y autorización del trabajo.
2. Las decisiones ADR/DEC cerradas y los documentos normativos aplicables determinan arquitectura e invariantes.
3. Los casos de uso y las reglas de negocio determinan comportamiento; la persistencia y las interfaces no pueden redefinirlo.
4. Cada tarea modifica únicamente los archivos necesarios para sus criterios de aceptación.
5. No se refactoriza, renombra, mueve o reformatea código no relacionado.
6. No se modifica el legado para aparentar que implementa la arquitectura objetivo.
7. No se crean migraciones o DDL mientras el gate correspondiente permanezca en `NO-GO`.
8. No se hace commit ni push salvo autorización explícita.

## Arquitectura

1. La implementación objetivo aplica Clean Architecture y Ports & Adapters de forma verificable.
2. `domain` contiene entidades, value objects, invariantes y servicios de dominio sin dependencias de framework, persistencia, transporte o proveedor.
3. `application` contiene casos de uso y puertos propios. Puede depender de `domain`, pero no de adaptadores concretos.
4. `infrastructure` implementa puertos y contiene persistencia, mensajería, proveedores externos y detalles técnicos.
5. Las interfaces de entrada, incluidos controllers y handlers, validan y traducen contratos, invocan casos de uso y traducen resultados; no contienen reglas de negocio.
6. La composición y la inyección de dependencias mediante NestJS pertenecen al composition root o a los módulos correspondientes.
7. El dominio no importa NestJS, React, Electron, Kysely, drivers, adaptadores ni módulos de infraestructura.
8. Un caso de uso no instancia infraestructura ni accede directamente a tablas internas de otro módulo.
9. Los adaptadores implementan puertos; no convierten reglas específicas del proveedor en reglas del dominio.
10. No se crea una arquitectura paralela ni se introducen capas, wrappers o abstracciones sin una necesidad actual verificable.

## TypeScript del stack objetivo

1. TypeScript utiliza `strict: true`.
2. No se usa `any` salvo necesidad técnica inevitable, localizada y justificada explícitamente.
3. No se usa `@ts-ignore` para ocultar errores de tipos.
4. No se usan non-null assertions innecesarias.
5. Las entradas externas se validan en runtime en la frontera correspondiente.
6. Estados, decisiones, códigos e identidades de dominio se modelan mediante tipos, enums o value objects cuando corresponda.
7. No se sustituyen invariantes mediante type casts ni se aceptan objetos parcialmente válidos dentro del dominio.
8. Los contratos compartidos mantienen versionado y compatibilidad según las decisiones aplicables.

Estas reglas no exigen convertir el legado Python a TypeScript fuera de una tarea de migración expresamente autorizada.

## Calidad y mantenibilidad

1. No se crean God Services, archivos gigantes o funciones de cientos de líneas sin una justificación técnica revisable.
2. Cada módulo conserva responsabilidades cohesivas y fronteras explícitas.
3. No se duplican invariantes, decisiones de autorización, cálculos ni normalizaciones.
4. No se usan magic strings para estados, eventos, permisos, capacidades, errores u otros conceptos de dominio.
5. No se agrega código muerto, abstracciones especulativas ni patrones "por si acaso".
6. No se agregan comentarios que solo repitan el código.
7. El código, los logs y la documentación técnica no incluyen emojis, etiquetas decorativas ni texto ornamental.
8. Las excepciones y errores de dominio utilizan contratos estables y no dependen de mensajes libres como interfaz técnica.

## Datos, tenancy e integridad

1. El dinero y las cantidades que exijan exactitud decimal nunca se representan ni persisten con `float`, `double` o tipos binarios equivalentes.
2. Todo recurso multi-tenant conserva `tenant_id` en las fronteras y relaciones exigidas por el modelo normativo.
3. Un `tenant_id` suministrado libremente por el cliente no constituye autoridad. Debe validarse contra identidad autenticada, pertenencia, sesión y contexto autorizado.
4. Ninguna consulta, escritura, relación, caché, evento, idempotency key o snapshot puede producir acceso o contaminación entre tenants.
5. Las relaciones con Company y Branch deben comprobar que todas las identidades pertenecen al mismo tenant.
6. No se borran silenciosamente entidades relacionadas ni hechos confirmados cuando el contrato exige historial, compensación o append-only.
7. La idempotencia es obligatoria donde la especificación la exige y debe persistir evidencia suficiente para responder reintentos.
8. Los timestamps son evidencia temporal; no se usan como regla genérica de resolución de conflictos, autoridad o last-write-wins.
9. Las operaciones local-first conservan identidad global, tenant, versión, causalidad y evidencia de reconciliación según `DEC-007`.
10. PostgreSQL y SQLite mantienen migraciones y pruebas físicas separadas cuando el modelo objetivo las autorice.

## Seguridad

1. No se hardcodean secretos, contraseñas, tokens, claves privadas, API keys ni credenciales.
2. No se incorporan secretos ni datos sensibles a código, fixtures, documentación, logs, errores o snapshots no autorizados.
3. El backend revalida todas las entradas y decisiones críticas; no confía en permisos, estados o cálculos enviados por frontend.
4. Autenticación, pertenencia al tenant, autorización y licenciamiento son decisiones distintas y ninguna sustituye a las demás.
5. Se aplica mínimo privilegio en puertos, adaptadores, consultas y credenciales de infraestructura.
6. Los cambios de seguridad incluyen pruebas negativas relevantes, especialmente para acceso cross-tenant y escalamiento de privilegios.
7. `docs/security/security-gates.md` define los gates `SEC-G01` a `SEC-G10`; su estado documental no equivale a control implementado ni evidencia aprobada.
8. Una funcionalidad crítica no está terminada solo porque compile o pase pruebas funcionales: debe satisfacer los security gates aplicables.

## Evaluación de seguridad por módulo crítico

Antes de cerrar cualquier cambio crítico de Sales, Payments, Cash Register, Inventory, Licensing, Devices, Sync, Electronic Invoicing o Administration, el diseño, las pruebas y la entrega deben responder explícitamente:

1. si puede leer, modificar, borrar, referenciar o ejecutar sobre otro tenant;
2. qué actor, permiso y alcance pueden ejecutarlo;
3. si puede repetirse y cómo conserva idempotencia;
4. si admite replay, duplicado o reordenamiento y cómo se rechazan;
5. cómo se detecta payload manipulado y cuándo exige autenticidad fuerte;
6. qué autoridad decide conectado y offline;
7. qué se audita y qué señales antifraude produce;
8. si toca secretos, credenciales o datos sensibles;
9. qué ocurre ante fallo parcial, timeout o incertidumbre;
10. si requiere segregación, aprobación superior, reautenticación o MFA.

Cada respuesta debe enlazar amenaza, control, prueba futura o ejecutada y evidencia. “No aplica” requiere justificación explícita. Un checksum simple no demuestra autenticidad ante un atacante que controla SQLite; cuando el riesgo exige autenticidad fuerte se utiliza la identidad criptográfica definida por `DEC-008` o una decisión posterior equivalente.

## Dependencias e infraestructura

1. No se agrega una dependencia sin una necesidad concreta, evidencia de mantenimiento y comprobación de que el repositorio no resuelve ya el problema.
2. Las versiones se fijan conforme a `ADR-005` y a la política de lockfile cuando el esqueleto objetivo esté autorizado.
3. No se introducen Kafka, Redis, microservicios, Kubernetes u otra infraestructura por anticipación.
4. No se seleccionan proveedores o adaptadores definitivos cuando la decisión normativa permanece abierta.
5. Una dependencia de framework o proveedor permanece fuera de `domain` y no redefine contratos funcionales.

## Pruebas

1. Todo comportamiento nuevo incluye pruebas relevantes para sus reglas, invariantes y casos límite.
2. Se priorizan pruebas de negocio, aislamiento multi-tenant, autorización, idempotencia, concurrencia, compensación y recuperación sobre tests cosméticos de getters.
3. No se modifican pruebas para aceptar comportamiento incorrecto ni se eliminan aserciones para ocultar una regresión.
4. Las pruebas existentes deben continuar pasando o cualquier fallo previo debe documentarse con evidencia reproducible.
5. Las reglas deterministas del dominio deben probarse sin infraestructura externa.
6. Las restricciones dependientes del dialecto deben validarse por separado en PostgreSQL y SQLite cuando existan adaptadores y migraciones autorizados.
7. Los fixtures no contienen secretos ni datos reales y mantienen separación explícita entre tenants.

## Procedimiento obligatorio de cambio

Antes de editar:

1. verificar rama y `git status`;
2. identificar el elemento del backlog y comprobar que está autorizado;
3. leer las fuentes normativas aplicables;
4. buscar implementaciones, modelos, contratos y migraciones existentes;
5. enumerar los archivos exactos que se crearán o modificarán y justificar cada uno;
6. detenerse si existe una contradicción normativa o un gate en `NO-GO`.

Durante la implementación:

1. mantener el cambio mínimo y dentro del dominio autorizado;
2. preservar cambios previos del usuario y no sobrescribir trabajo no relacionado;
3. mantener las reglas de negocio fuera de controllers y adapters;
4. añadir pruebas junto con el comportamiento;
5. registrar cualquier deuda real sin crear trabajo especulativo para resolverla.

## Validación y entrega

Se ejecutan los scripts reales disponibles y proporcionales al cambio. Cuando existan en el stack afectado, la validación mínima incluye:

1. tests relevantes;
2. suite completa cuando sea razonable;
3. lint;
4. typecheck y build;
5. validaciones de migración por dialecto cuando estén autorizadas y sean aplicables;
6. `git diff --check`;
7. `git status --short`;
8. revisión resumida del diff.

Para una versión o funcionalidad crítica se añade la evaluación de `SEC-G01` a `SEC-G10` que corresponda. Un gate en `FAIL`, `BLOCKED` o sin evaluar impide declarar aptitud productiva; una excepción `NOT_APPLICABLE` requiere justificación aprobada y versionada.

No se inventan comandos ausentes. Si el repositorio todavía no ofrece un script requerido, se informa como limitación y no se declara validado.

La entrega final debe indicar:

1. archivos creados y modificados;
2. requisito implementado por cada archivo;
3. invariantes y decisiones preservadas;
4. comandos ejecutados y resultados concretos;
5. deuda técnica real y decisiones pendientes;
6. contradicciones encontradas;
7. resumen del diff;
8. confirmación de que no se hizo commit ni push.

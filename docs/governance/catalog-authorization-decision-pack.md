# Decision pack — autorización para materializar `snapshot_type = CATALOG`

## Estado

`DECISIÓN PENDIENTE DE FIRMA` — 2026-09-06. **Este documento no autoriza nada.**

Es el paquete de decisión que el responsable del producto necesita para decidir
si amplía `DEC-012` §32.1. Ninguna de sus secciones constituye autorización:
la autorización sería una sección nueva firmada en `DEC-012`, siguiendo el
mismo mecanismo que §32.

## 1. Por qué existe este documento

`Sales V1` funciona pero se apoya en `sandbox_catalog_product`,
`sandbox_catalog_presentation` y `sandbox_price_rule` —tablas que sólo pueblan
las pruebas—. Sin catálogo real no se puede vender un producto real.

La arquitectura del catálogo **ya está decidida** y no admite una tabla local
inventada: `DEC-013` §7 fija cuatro `snapshot_type` —`CATALOG`, `PRICING`,
`TAX`, `CASH_REGISTER`— y el catálogo llega al POS como snapshot maestro
firmado por la autoridad central, por la misma ruta `VERIFY → VALIDATE → WRITE →
ACTIVATE` que ya recorre `CASH_REGISTER`.

Construir un catálogo local por CRUD crearía una segunda autoridad de datos
maestros y violaría `DEC-013`. No es una opción disponible.

## 2. Qué bloquea hoy

`DEC-012` §32.1, autorización humana firmada el 2026-09-04, autoriza los
componentes de snapshot maestro **«acotados exclusivamente a `snapshot_type =
CASH_REGISTER`»**.

El código respeta esa acotación en tres lugares:

| Lugar | Estado actual |
|---|---|
| `local-database.ts:329` | `CHECK(snapshot_type = 'CASH_REGISTER')` |
| `packages/contracts/src/master-snapshot.ts:26` | `MasterSnapshotTypeSchema = z.literal("CASH_REGISTER")` |
| `master-snapshot.ts:11-12` | comentario que cita `DEC-013` §7 y `DEC-012` §32 como razón |

La restricción no es un descuido: es la autorización implementada.

## 3. Coste técnico real de ampliarla

### 3.1 Reconstrucción de tabla — el punto delicado

SQLite **no permite alterar un `CHECK`**. Ampliar el dominio de `snapshot_type`
exige reconstruir `local_master_snapshot_artifact`: crear la tabla nueva, copiar
filas, borrar la vieja, renombrar.

Existe precedente propio y verificado: `MIGRATION_008` reconstruyó
`local_operation_audit` con exactamente ese patrón
(`local_operation_audit_rebuilt` → `INSERT INTO … SELECT` → `DROP TABLE` →
`ALTER TABLE … RENAME TO`), incluida la recreación de índices y triggers.

Riesgo asociado, que debe declararse: la reconstrucción rompe la invariante de
**cero deleciones** que las once migraciones actuales mantienen. Es el patrón
`D4` que ya se identificó como riesgo en `DEC-012`.

**Mitigación disponible sin decisión nueva:** `LocalDatabase.open` ya crea un
backup verificado antes de migrar cuando la base existía previamente
(`createVerifiedBackup("pre-migration")`), y `assertIntegrity()` corre después.

### 3.2 Contrato

`MasterSnapshotTypeSchema` pasa de `z.literal` a `z.enum` con los tipos
autorizados. Cambio aditivo en el contrato; los consumidores actuales de
`CASH_REGISTER` no se ven afectados.

### 3.3 Payload del catálogo

`DEC-013` §7 exige que el `snapshot_type` **coincida con el verificador y con el
contrato de payload aplicado**. Hoy no existe contrato de payload para
`CATALOG`: habría que definirlo, y esa definición es trabajo de diseño, no de
implementación mecánica.

## 4. La dependencia que ninguna autorización resuelve

Aunque se firme la ampliación, **el catálogo no funcionaría todavía**:

- `MasterSnapshotVerifier` **nunca se construye en el runtime**. Existe la
  clase; ningún componente la instancia.
- No hay claves de firma aprovisionadas. `CommercialComponent` recibe
  `sessionSigningKeys` como `new Map()` vacío por la carencia `LIC-003` /
  `DEV-003`, y falla cerrado por diseño.
- No existe transporte que traiga el snapshot desde la central.

Un snapshot `CATALOG` sería rechazado exactamente igual que hoy se rechaza
`session.activate`. **Firmar la ampliación es necesario pero no suficiente.**

## 5. Opciones

### Opción 1 — Ampliar §32 sólo a `CATALOG`

Alcance mínimo. Deja `PRICING` y `TAX` para decisiones posteriores.
Una reconstrucción de tabla ahora, y otra cuando se amplíe de nuevo.

### Opción 2 — Ampliar §32 a `CATALOG`, `PRICING` y `TAX` a la vez

Los cuatro tipos de `DEC-013` §7 quedan admitidos en el `CHECK` y en el
contrato en **una sola reconstrucción**. No obliga a implementar los tres: el
`CHECK` admite un dominio que el código puede seguir usando parcialmente.

Precedente del propio repositorio: `MIGRATION_011` escribió los `CHECK` de
Payment con los enums **completos** de `PAY-007`, no con el subconjunto de V1,
precisamente para no verse obligado a reconstruir después.

### Opción 3 — No ampliar todavía

Coherente si se decide que el orden correcto es resolver antes el
aprovisionamiento de claves y el transporte, ya que sin ellos el catálogo no
puede operar. El POS sigue sin poder vender producto real.

## 6. Recomendación técnica

**Opción 2**, por una razón concreta y con precedente: evita una segunda
reconstrucción de `local_master_snapshot_artifact`, y cada reconstrucción es el
momento de mayor riesgo para una base instalada. Admitir el dominio completo de
`DEC-013` §7 en el `CHECK` no obliga a materializar `PRICING` ni `TAX`, igual
que `MIGRATION_011` admitió estados de pago que V1 no usa.

La recomendación es sobre **el alcance del `CHECK` y del contrato**, no sobre
implementar tres proyecciones.

## 7. Qué se firmaría

Una sección nueva en `DEC-012`, con la forma de §32, que declare:

1. el dominio de `snapshot_type` autorizado;
2. autorización explícita para reconstruir `local_master_snapshot_artifact`,
   reconociendo la ruptura de la invariante de cero deleciones;
3. que la ampliación **no** autoriza implementar la proyección de catálogo, su
   contrato de payload, el verificador ni el transporte, cada uno de los cuales
   requiere su propio bloque;
4. fecha y responsable.

## 8. Qué no debe hacerse mientras tanto

- Crear tablas de catálogo locales fuera de la ruta de snapshot maestro.
- Poblar `sandbox_catalog_product` en producción: es fixture de prueba.
- Ampliar el `CHECK` sin la firma, aunque sea técnicamente trivial.

# Certificación comercial RUNTIME_VERIFIED — PR #130 (2026-11-23)

**Commit auditado:** `3bc4f935d4f5a104d734aa5b2ca36b88db4cd227` (tip al inicio de esta certificación)  
**Rama:** `cursor/commercial-license-global-c53a`  
**PR:** #130 (Draft — sin merge)  
**Entorno ejecutor:** Cursor Cloud Agent (sin Docker, sin `CENTRAL_*` / `FACTUS_*` en proceso)

## Conclusión

**`RUNTIME_VERIFIED` = NOT_VERIFIED**

No se cumplen los ocho criterios de cierre. CI exact-HEAD verde y el código de fulfillment autónomo **no** sustituyen PostgreSQL comercial autorizado + FACTUS Pay sandbox con pago auténtico + activación de dispositivo.

## Niveles observados (no inventados)

| Nivel | Estado | Evidencia |
|---|---|---|
| `IMPLEMENTED` | YES | Cola 035, `issueAsService`, worker, webhook→queue, inyección gateway GET |
| `CI_PASS` | YES en tip auditado | 11/11 SUCCESS en `3bc4f935` |
| `POSTGRES_VERIFIED` | NO | Sin instancia PG autorizada reachable; Docker ausente; migrador no ejecutado contra lab |
| `FACTUS_SANDBOX_VERIFIED` | NO | Secretos sandbox no disponibles en el agente; gate wave7 intacto (otra rama) |
| `LICENSE_ISSUED` | NO | No hubo pago sandbox auténtico confirmado |
| `DEVICE_ACTIVATED` | NO | Sin allocate/activate en lab |
| `RUNTIME_VERIFIED` | **NO** | Fallan PG + FACTUS + emisión + activación |

## Checksum 035 (artefacto local)

```text
035_subscription_license_fulfillment.up.sql
sha256=f09713523475d977ab60185e35026ad63e4e6ccfcacf2f9a90cbee9bf71d6178
```

Estado ledger remoto: **UNKNOWN** (no hay `CENTRAL_DATABASE_URL` / `POSTGRES_MIGRATOR_URL`).

## Auditoría de entorno autorizado

| Recurso | Hallazgo |
|---|---|
| Cloud Agent secrets | vacíos (`list-available-secrets`) |
| Env proceso `CENTRAL_*` / `POSTGRES_*` / `FACTUS_*` | ausentes |
| Docker | no disponible |
| `gh secret list` | HTTP 403 (token read-only / sin admin) |
| Gate FACTUS excepcional | restringido a `cursor/wave7-factus-1766` — **no modificado** |
| Secretos FACTUS en Actions | referenciados en YAML; no inyectables aquí |
| PG comercial durable | no localizado |

## Corrección aplicada en esta continuación

Inyección del adaptador oficial Factus Pay GET en Central:

- `CENTRAL_SUBSCRIPTION_FACTUS_PAY_GATEWAY_FILE` → `prepareSubscriptionFactusPayGateway`
- Se pasa a `prepareSubscriptionFulfillmentRuntime({ factusPay })` y a GLOBAL quotes
- Sin cliente paralelo ni respuesta `paid` simulada

Vía de certificación específica PR #130 (sin tocar el lock wave7):

- Input `run_commercial_license_runtime_cert` en `target-foundation-validation.yml`
- Autorización `OWNER_AUTHORIZED_COMMERCIAL_RUNTIME_CERT`
- Rama obligatoria `cursor/commercial-license-global-c53a`
- Tip SHA exacto

## Casos A–H

| Caso | Resultado en este entorno |
|---|---|
| A pérdida de comunicación | NO EJECUTADO — requiere PG+FACTUS |
| B webhook sin enqueue + restart | Cubierto a nivel unitario en tip; no runtime Central |
| C webhook duplicado | Unit/contrato; no runtime |
| D concurrencia workers | Semántica unitaria; no runtime multi-proceso |
| E FACTUS indisponible | NO EJECUTADO |
| F banco manual excepcional | NO EJECUTADO — sin MFA GLOBAL lab |
| G conciliación posterior | Código presente; no runtime |
| H aislamiento POS webhook | Filtro unitario; no runtime |

## Bloqueos pendientes (exactos)

1. **POSTGRES_LAB_UNAVAILABLE** — falta base comercial-test autorizada con `pos_migrator` / `pos_platform_app`, historial 001…023 y backup policy.
2. **FACTUS_PAY_SANDBOX_UNAVAILABLE_IN_AGENT** — credenciales sandbox no presentes; gate wave7 no reutilizable sin cambiar restricciones (prohibido).
3. **CENTRAL_RUNTIME_NOT_PROVISIONED** — sin TLS/deployment/GLOBAL/fulfillment files en este agente.
4. **DEVICE_ACTIVATION_LAB_ABSENT** — sin hardware ni simulador de protocolo autorizado aquí.
5. **OWNER_DISPATCH_REQUIRED** — el job PR #130 debe dispararse desde Actions con la autorización exacta una vez el tip lo contenga.

## Qué no se hizo

- No se crearon credenciales ficticias.
- No se falsificó `paid`.
- No se debilitó el lock wave7.
- No se abrió otra PR.
- No se fusionó a `main`.
- No se declaró certificación comercial.

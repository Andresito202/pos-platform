# Cierre técnico del catálogo V2 — 2026-10-28

Línea: `feat/android-commercial-runtime`; base publicada `bffcbcc5a68e71046746e7b628cc777d26fb3d8c`, WIP conservado `59fecab5885f7af1c3877201ea03b910114d58de`. PR #96 permanece Draft. Sin Actions, merge, datos comerciales ni cambios en `oracleJdk-27`.

## Implementado y probado localmente

- Migración aditiva 023 en el runner canónico `--license-catalog`. Conserva importes y perfil V1; explicita COP/exponente 2, soporte y alcance PREPRODUCTION para V2. Down físico previo a datos V2; después rechaza destruir historia V2.
- Inicialización GLOBAL opt-in crea solamente borradores ausentes: mensual 49.900/19.900/14.900, anual 499.000/199.000/149.000 y perpetuo 1.490.000/490.000/249.000 COP. Una caja incluida. Ninguna lectura sustituye precios con constantes. No se ejecutó sobre una base persistente.
- Editor GLOBAL existente: vista previa, guardado durable, recuperación, confirmación explícita, nueva versión, auditoría y conflicto de versiones. Soporte perpetuo de doce meses; derecho de uso perpetuo independiente.
- Catálogo público HTTPS `/v1/licensing/offers` y página `/pricing/` del mismo build. Sólo ofertas V2 activas; DTO validado, ETag y revalidación, sin cookies GLOBAL ni datos de compradores. No se conectó una web externa.
- Administrador empresarial: lectura del catálogo público mediante `license.offers.list`, transporte existente y sesión SSA/SAS revalidada después del await. Sin autoridad de edición GLOBAL ni grants nuevos. Una vista de contrato privado no está implementada en este panel y se indica expresamente.
- Cotizaciones: nueva versión vigente, calendario mes/año, soporte de doce meses, snapshots anteriores inmutables, concurrencia y rollback de auditoría. La política fiscal sigue siendo dependencia obligatoria; las cifras tributarias del test son fixtures explícitos.

## Evidencia reproducible

PostgreSQL temporal `target-migrations-postgres-1`, puerto 55433, datos en tmpfs, base aleatoria `pos_subscription_quotes_test_*`, eliminada al finalizar. Electron real con autenticador virtual de laboratorio, certificado TLS efímero y usuario/roles de fixture; no acredita persona ni proveedor externo.

```powershell
$env:POSTGRES_TEST_URL='postgresql://postgres@127.0.0.1:55433/postgres'
$env:POS_E2E_AUDIT_DIRECTORY=(Join-Path (Get-Location) 'artifacts/licensing/2026-10-28/pricing')
pnpm --filter @pos-platform/central-authority exec vitest run tests/subscription-quotes-physical.test.ts -t 'FACTUS API:|GLOBAL:|pricing V2:' --reporter=json --outputFile=../../artifacts/licensing/2026-10-28/pricing-final.json
pnpm --filter @pos-platform/contracts exec vitest run tests/license-offer-v2.test.ts
pnpm --filter @pos-platform/pos-local-service exec vitest run tests/commercial-ipc.test.ts tests/license-offer-catalog.test.ts -t 'license catalog:|public price HTTP:'
pnpm --filter @pos-platform/pos-local-service exec vitest run tests/channel-commercial-transport.test.ts -t 'license.offers.list'
pnpm --filter @pos-platform/pos-desktop exec vitest run tests/renderer/platform-client.test.ts tests/renderer/public-license-client.test.ts tests/renderer/business-license-offers.test.tsx
```

Resultados: contratos 5 PASS; Service 2 PASS/46 filtrados; transporte 1 PASS/7 filtrados; renderer 5 PASS. Central/PostgreSQL/Electron 3 PASS/4 filtrados. El escenario FACTUS usa un doble TLS controlado, necesario como predecesor del escenario GLOBAL, no una consulta al proveedor.

El E2E publica las tres modalidades, guarda mensual 59.900 COP, pierde el estado del renderer, recupera el borrador con MFA, publica y verifica el nuevo importe en la página pública y en el editor sin recompilar ni cambiar sus assets. Ver `platform-observations.json` y `platform-published.png` en el directorio de evidencia. La lectura empresarial tiene prueba de handler, transporte y componente; no se atribuye una ceremonia humana completa a esas pruebas separadas.

Fallo conservado `pricing-first.json`: el driver pulsaba la confirmación antes de que React terminara la selección; se corrigió la espera, sin relajar producto ni seguridad. `pricing-second.json` y posteriores pasaron. TypeScript afectados, build Desktop, ARCH-003 y sus 16 pruebas pasaron.

## Pendientes auténticos

1. Central HTTPS, operador, DNS/TLS, identidades, claves y DEV-003 auténticos; certificación humana Windows. El login no se reconstruyó.
2. Política fiscal y términos operativos de soporte: publicación PREPRODUCTION no autoriza cobros productivos.
3. FACTUS Pay: cuenta declarada por el propietario; `CENTRAL_FACTUS_PAY_COLLECTIONS_PROVISION_FILE` ausente en esta consola y custodia sin confirmar. No se llamó `/auth`, no se usaron tokens, no se listaron ni crearon recaudos.
4. FACTUS V2: conservar OAuth/numeración sandbox históricos. Se prohíbe usar el secreto anterior mientras no se confirme su rotación. Emisión fiscal y correo requieren empresa, políticas y servicios autorizados.
5. Web pública externa, lectura privada de contrato empresarial y términos de renovación comercial no se consideran materializados por las tarjetas de ofertas.
6. CI remoto pendiente: no ejecutado por instrucción del propietario. PR Draft; sin certificación productiva.

## SHA-256 de evidencia local

- `pricing-final.json`: `c67348bfb26cfa24987a9f7035d884c08bd8bea2380ee86000869e5360699886`
- `price-contracts.json`: `b0ffffe97e7d5ec97cfa05f463455cb56c2de83b97382550736ba3c4db3a1b8a`
- `business-catalog.json`: `ce092dc1534bd284ae7cc1c0eea0bfacc4c78868895c6e1d6a2e3c7ce7c8a32c`
- `catalog-transport.json`: `f26a222f4a978659f11fd9e8b13056b23dc02c66cf70d001cad954090948ba42`
- `catalog-renderer.json`: `81cc6475a0dda148be7ff304a2a454879f841220f12416a41d67c4e66f188168`

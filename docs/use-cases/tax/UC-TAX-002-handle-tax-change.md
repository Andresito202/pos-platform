# UC-TAX-002: Gestionar cambio tributario

## Objetivo

Crear, programar, activar o retirar una regla tributaria sin alterar documentos históricos ni operaciones cerradas.

## Actor principal

Propietario, administrador fiscal autorizado o integración fiscal administrada.

## Precondiciones

- Usuario autenticado.
- Empresa activa.
- Permiso atómico correspondiente a la acción: `tax.rule.create_draft`, `tax.rule.publish`, `tax.rule.schedule`, `tax.rule.revoke` o `tax.rule.supersede`.
- Jurisdicción válida.
- Motivo documentado.
- Reautenticación cuando corresponda.

## Entrada

- tax_rule_id opcional;
- tax_category;
- tax_code;
- rate;
- included_in_price;
- scope;
- valid_from;
- valid_until opcional;
- legal_reference opcional;
- reason;
- expected_version;
- idempotency_key.

## Flujo principal

1. El usuario o integración propone la regla.
2. El sistema valida alcance, tasa, fechas y jurisdicción.
3. Busca reglas equivalentes vigentes o futuras.
4. Detecta solapamientos.
5. Muestra productos, categorías y sucursales afectadas.
6. Exige confirmación reforzada cuando el impacto sea alto.
7. Crea una nueva versión.
8. No modifica snapshots históricos.
9. Invalida cachés al comenzar la vigencia.
10. Registra auditoría.
11. Emite eventos de programación o activación.

## Reglas

1. Las reglas activas no se editan destructivamente.
2. Todo cambio crea versión nueva.
3. La fecha final debe ser posterior a la inicial.
4. Una tasa no puede ser negativa.
5. No pueden existir reglas equivalentes y solapadas con igual prioridad.
6. El cambio no modifica ventas cerradas.
7. Los carritos abiertos deben seguir la política de revalidación definida.
8. No se imprimirá información fiscal sin datos válidos.
9. La configuración de otra empresa no puede reutilizarse automáticamente.
10. Los cambios críticos deben quedar auditados.
11. Leer una regla usa `tax.rule.read`; ningún permiso concede por sí solo otra acción del lifecycle.
12. Restaurar una conducta anterior publica una versión nueva mediante `tax.rule.supersede`; no reactiva ni muta una versión histórica.

## Cambio inmediato

Debe:

- mostrar impacto;
- exigir motivo;
- invalidar caché;
- notificar aplicaciones conectadas;
- no alterar ventas ya confirmadas.

## Cambio futuro

Debe:

- quedar programado;
- activarse en la fecha correspondiente;
- emitir evento de activación;
- permitir simulación previa.

## Retiro de regla

No elimina el historial.

Debe:

- cerrar vigencia;
- conservar versiones;
- impedir nuevas resoluciones fuera del periodo válido.

## Excepciones

- tasa inválida;
- vigencia solapada;
- referencia inexistente;
- versión desactualizada;
- falta de permiso;
- intento de modificar histórico;
- acceso entre tenants.

## Postcondiciones

- La regla queda versionada.
- El historial permanece intacto.
- Las nuevas operaciones pueden resolver la configuración correcta.

## Eventos

- `TaxRuleScheduled`;
- `TaxRuleActivated`;
- `TaxRuleExpired`;
- `TaxRuleChanged`.

## Pruebas mínimas

- regla futura;
- cambio inmediato;
- solapamiento;
- tasa negativa;
- regla incluida en precio;
- retiro controlado;
- conflicto de versión;
- reautenticación;
- aislamiento entre tenants.

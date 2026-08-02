# UC-LIC-001: Validar licencia

## Actor principal

POS, panel o servicio autorizado.

## Precondiciones

- Existe una licencia emitida.
- La aplicación dispone de clave pública o conexión segura al servicio central.

## Entrada

- license_token;
- tenant_id;
- device_id;
- app_version;
- requested_feature.

## Flujo híbrido

1. La aplicación valida firma y estructura local.
2. Evalúa fechas, modalidad, límites y dispositivo.
3. Consulta estado central cuando hay conexión.
4. Actualiza caché de licencia.
5. Determina funciones habilitadas.
6. Registra anomalías.

## Flujo local perpetuo

1. La aplicación valida firma local.
2. Verifica dispositivo, versión y módulos.
3. No requiere validación permanente por Internet.
4. Aplica límites contractuales.

## Estados

- ACTIVE;
- TRIAL;
- PAST_DUE;
- GRACE_PERIOD;
- RESTRICTED;
- SUSPENDED;
- CANCELLED;
- INVALID.

## Reglas

- Una venta activa no se bloquea abruptamente por cambio de estado.
- Los avisos preceden restricciones.
- No se borran datos.
- La clave privada nunca está en el cliente.
- Manipular el archivo invalida la firma.

## Pruebas mínimas

- licencia activa;
- vencida;
- periodo de gracia;
- dispositivo distinto;
- firma alterada;
- módulo no contratado;
- operación sin Internet;
- reactivación.

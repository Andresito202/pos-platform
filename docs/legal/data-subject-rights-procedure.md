# Procedimiento de atención de derechos de titulares — Camacho POS Colombia

**Estado:** MATERIALIZADO  
**Fecha:** 2026-10-07

## Responsable y canal

- **Responsable:** CamachoPosColombia SAS
- **Contacto:** Wilson Andrés Camacho Culma
- **Correo:** andrescamacho.19@hotmail.com
- **Teléfono:** 3227506213
- **Dirección:** Transversal 3A #87B-45 Sur, Bogotá D.C., Colombia
- **NIT:** pendiente de formalización

## Solicitudes admitidas

El canal permite recibir solicitudes de:

1. consulta y acceso a datos personales;
2. actualización o rectificación;
3. prueba de autorización cuando corresponda;
4. información sobre el tratamiento;
5. revocatoria de autorización cuando legalmente proceda;
6. supresión de datos cuando legalmente proceda.

## Solicitud de eliminación

La solicitud debe indicar razonablemente quién solicita, qué dato o relación desea eliminar y un medio para localizar el registro. Antes de ejecutar cualquier medida se debe verificar la identidad y autoridad del solicitante.

La solicitud **no implica borrado físico automático**. El Responsable debe determinar si existen obligaciones fiscales, contables, contractuales, probatorias, de auditoría o de seguridad que obliguen a conservar determinados registros.

Cuando la supresión física sea improcedente, la respuesta deberá indicar el motivo y, cuando corresponda, aplicar anonimización, desidentificación, bloqueo o restricción de uso compatible con las obligaciones de conservación.

## Flujo operativo

1. Recibir la solicitud por el canal oficial.
2. Registrar fecha, solicitante y tipo de derecho sin incorporar datos innecesarios.
3. Verificar razonablemente identidad y legitimidad.
4. Localizar la información relevante dentro del tenant/ámbito autorizado.
5. Evaluar excepciones y obligaciones de conservación.
6. Ejecutar la medida procedente o documentar por qué no procede.
7. Mantener evidencia mínima de la gestión, evitando copiar datos personales innecesariamente al registro de auditoría.
8. Responder dentro de los términos legales aplicables.

## Integridad del POS

No se implementa `customer.delete` como borrado físico indiscriminado. La arquitectura existente mantiene trazabilidad fiscal, contable y de auditoría; destruir esas evidencias para satisfacer una solicitud sin evaluar la obligación de conservación sería incorrecto.

Una futura materialización técnica de anonimización/desidentificación deberá respetar las relaciones históricas y no crear un segundo modelo de clientes.

## Estado

**Solicitud de eliminación:** canal operativo materializado mediante el contacto oficial y procedimiento documentado.  
**Eliminación automática desde el POS:** NO MATERIALIZADA; requiere primero definir las reglas de retención y anonimización por entidad.  
**NIT:** pendiente de formalización.

# Términos y condiciones del servicio — Camacho POS Colombia

> **BORRADOR — DOCUMENTED únicamente. No publicar sin revisión de abogado colombiano y sin completar los campos [PENDIENTE].**
> Este texto no es asesoría legal. Redactado el 2026-09-26. Describe el servicio tal como existe en
> el repositorio a esa fecha; no promete funciones que no existen.

## 1. Partes

- **La Plataforma:** [PENDIENTE — razón social del responsable], NIT [PENDIENTE — NIT del
  responsable], con domicilio en [PENDIENTE — domicilio y dirección física del responsable].
- **El Comercio:** la persona natural o jurídica que contrata el software para operar su punto de
  venta.

`Camacho POS Colombia` es un nombre comercial **no registrado como marca** (`docs/product/brand.md`).

## 2. Qué es el servicio

Un software de punto de venta para comercios en Colombia, compuesto por:

- una aplicación de escritorio para Windows que el Comercio instala en sus equipos;
- un servicio local que guarda la operación en el propio equipo y permite vender sin Internet;
- un servicio central, que sincroniza y administra.

**Estado real a la fecha:** el software **está en desarrollo y no se ofrece en producción**. No
existe todavía un instalador firmado para distribución (`docs/product/backlog.md`, `RT-009-B`), ni
el inicio de sesión real de usuarios (`DEC-026`), ni una instancia central desplegada. Estos
términos no rigen hasta que el servicio se ofrezca comercialmente. [PENDIENTE — fecha de inicio de
la oferta comercial].

## 3. Cuentas y acceso

- Cada usuario tiene una cuenta **individual**. Compartir contraseñas o PIN está prohibido.
- Los roles de administración usan un segundo factor obligatorio (`DEC-026` §5).
- El Comercio es responsable de dar de alta y de baja a su personal, y de pedir que se revoque el
  acceso de quien deje de trabajar con él.
- El Comercio es responsable de la seguridad física de sus equipos. La base de datos local **no está
  cifrada en reposo** (`politica-tratamiento-datos.md` §11).

## 4. Datos personales

- Los datos de los usuarios del software los trata la Plataforma como **Responsable**.
- Los datos de los clientes del Comercio los trata el **Comercio como Responsable**; la Plataforma
  actúa como su **Encargado** y sólo los procesa para prestar el servicio.
- El Comercio se obliga a obtener y conservar la autorización de sus clientes, a atender sus
  consultas y reclamos, y a dar su propio aviso de privacidad (modelo en `aviso-privacidad.md` §B).
- Detalle completo: `politica-tratamiento-datos.md`. Terceros: `terceros-y-encargados.md`. Uso de
  inteligencia artificial: `declaracion-uso-ia.md`. Supresión: `derecho-supresion.md`.
- La relación de encargo se formaliza en un contrato de transmisión: [PENDIENTE — modelo de contrato
  de transmisión Comercio–Plataforma].

## 5. Obligaciones fiscales

- **El Comercio sigue siendo el único responsable ante la DIAN** de sus obligaciones tributarias,
  de la veracidad de lo que factura y de la conservación de sus documentos.
- El software emite la factura electrónica a través de un proveedor tecnológico (hoy, Factus). La
  Plataforma no es ese proveedor y no sustituye la relación del Comercio con él.
- Una factura rechazada, un rango de numeración vencido o un proveedor no disponible pueden impedir
  facturar. El software lo informa; no lo oculta ni «reintenta a ciegas».

## 6. Pagos electrónicos

- Los cobros por QR o enlace se procesan por una pasarela de pagos (hoy, Wompi) con la que el
  Comercio tiene su propia relación contractual.
- El software **no almacena datos de tarjeta**: el pagador los escribe en la página de la pasarela.

## 7. Uso aceptable

El Comercio no puede usar el servicio para actividades ilegales, para evadir obligaciones
tributarias, para tratar datos personales sin autorización, ni para intentar acceder a datos de
otros comercios.

## 8. Disponibilidad y limitaciones

- **No se ofrece acuerdo de nivel de servicio** mientras el servicio no esté en producción.
  [PENDIENTE — SLA, si se ofrece].
- La venta sin Internet funciona dentro de la vigencia de la sesión local (hasta 24 horas,
  `DEC-026` §11). Sin conexión y sin sesión vigente no se puede abrir una sesión nueva (`DEC-026` §4).
- [PENDIENTE — límites de responsabilidad, validados por abogado].

## 9. Terminación y datos

Al terminar el servicio, el Comercio podrá exportar sus datos y la Plataforma los eliminará o
anonimizará, salvo lo que la ley obligue a conservar (`RNF-PRV-004`,
`docs/product/non-functional-requirements.md:147`). **La exportación no está implementada todavía.**
[PENDIENTE — plazo de exportación y eliminación al terminar el servicio].

## 10. Precio, cambios, ley y jurisdicción

- Precio y forma de pago: [PENDIENTE — precios y condiciones de pago].
- Cambios a estos términos: se comunicarán con antelación. [PENDIENTE — plazo de preaviso].
- Ley aplicable y jurisdicción: [PENDIENTE — ley aplicable y jurisdicción, validadas por abogado].
- Contacto: [PENDIENTE — correo de contacto de protección de datos].

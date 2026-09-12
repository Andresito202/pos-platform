/**
 * Reexport de compatibilidad.
 *
 * `canonicalJson` se movió a `@pos-platform/local-channel` porque la firma del
 * canal la necesita y el paquete no puede importar del servicio. Pero **26
 * módulos del servicio** la usan para calcular `payload_checksum` y
 * `request_checksum` —persistencia, casos de uso y verificadores—, y reescribir
 * sus imports habría tocado Payments, Sales y Catalog sin ninguna necesidad
 * técnica.
 *
 * Una línea evita esa reescritura sin duplicar la implementación: hay un solo
 * `canonicalJson` en el repositorio.
 *
 * Deuda registrada: su sitio natural es `@pos-platform/contracts` —define la
 * representación byte a byte sobre la que se calculan checksums y MAC—, y no
 * `transport`. Moverlo allí es un cambio mecánico de 26 imports que corresponde
 * a un bloque propio.
 */
export { canonicalJson } from "@pos-platform/local-channel";

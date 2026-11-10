# Rediseño sobre referencias del propietario — 2026-11-10

final result: blocked

## Fuente y alcance

Referencias seleccionadas: 32294.png (Caja) y 32295.png (login), adjuntas por el propietario. Ambas se muestran a 1536 × 864; corresponden a ilustraciones, no a operaciones observadas. Fuente local de inspección: upload/01-32294.png y upload/02-32295.png, fuera del árbol del producto.

Implementación: App.tsx, LocalOperatorLoginPanel.tsx, SalePanel.tsx y workspace.css existentes en la única línea activa. No se creó una segunda aplicación, backend ni base de datos. Los casos de uso y la persistencia permanecen en el servicio local.

## Cambios funcionales

- Menú plegable con flechas Lucide y aria-expanded; ocultarlo conserva montada la venta. Cierre de sesión dentro del menú.
- Usuario de texto, contraseña con revelado opcional y limpieza del campo al enviar; sin seleccionar ni autoasignar roles.
- Seleccionar Efectivo/Transferencia no registra pagos. Confirmar cobro en efectivo y Reportar transferencia son acciones explícitas, con permisos, busy y resultado incierto protegidos.
- Contador de billetes/monedas oculto inicialmente, accesible desde un botón; conserva el conteo al ocultarse. El teclado numérico también es opcional.
- Composición azul oscuro/amarillo, tarjetas de productos, carrito y cobro compactos; estilos compartidos por los roles autorizados.

## Verificación visual bloqueada

Intento: renderer compilado servido en 4173 y sites-preview; navegador cloud abrió http://terminal.local:4173/ pero devolvió «upstream connect error or disconnect/reset before headers. reset reason: connection termination», persistente tras recarga. No existe captura de implementación válida. No se comprobó consola de la aplicación ni interacción visual. No se hizo comparación conjunta ni de regiones. Viewports objetivo: escritorio 1536 × 864 y móvil 390 × 844; ninguno certificado visualmente. Normalización de densidad: pendiente.

## Superficies de fidelidad

- Tipografía: pila existente Bahnschrift/Segoe UI/system; tamaños y jerarquía ajustados, renderizado pendiente.
- Espaciado: navegación 224 px; productos/carrito en dos columnas en escritorio; una columna bajo 1150 px. Overflow y zoom pendientes de navegador.
- Colores: menú #152530, acento #ffce32, entrada #082e50; foco y colores semánticos conservados. Contraste renderizado pendiente.
- Imágenes: se mantiene la marca amarilla original. El contrato del catálogo no entrega fotografía verificada; no se inventan productos ni existencias para reproducir la ilustración. La fotografía ambiental del login no está implementada.
- Contenido: nombres, permisos, turnos y pagos proceden de contratos existentes. No se agregan categorías, descuentos, suspensión, QR integrado ni tarjeta decorativos. Importe bancario recibido no se deduce del importe reportado.

## Hallazgos y cierre pendiente

[P1] No hay evidencia renderizada para afirmar semejanza 1:1; no declarar el rediseño terminado ni «100 % igual».
[P1] Fotografía ambiental y fotos de catálogo de la referencia no reproducidas; resolver activos reales y su contrato antes de presentarlos como datos de negocio.
[P2] Validar densidad de carrito/cobro, navegación, teclado y controles táctiles en escritorio y móvil; ajustar con capturas comparables.

Pruebas automatizadas verifican comportamientos con dobles del canal; no certifican una venta real contra SQLite ni Android/SCM de extremo a extremo. La revisión visual debe completarse sobre este mismo renderer, no mediante otra maqueta.

## Evidencia automatizada observada

277 pruebas desktop aprobadas (32 archivos), TypeScript del renderer y build de las tres entradas aprobados. Incluye selección de medio sin cobro, confirmación explícita, billetes ocultables con importe conservado, navegación sin desmontar venta, logout dentro del menú y formulario de credenciales sin autoridad de rol. Dependencias de caché Vite 6.4.3 / Vitest 4.1.11; no instalación frozen-lockfile.

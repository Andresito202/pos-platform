# Clientes en espera — 13 de noviembre de 2026

## Alcance implementado

En SalePanel: «En espera», «Ver en espera», recuperar y eliminar con confirmación. Guarda líneas, cantidades, referencia opcional y caja en SQLite; vacía el carrito solo tras confirmar el guardado. Para cambiar entre dos clientes, guardar primero el carrito activo y después recuperar el otro. La referencia libre sigue siendo una etiqueta de atención. Adicionalmente, el carrito permite buscar al cliente por documento mediante customer.find, vincular su customer_id y recuperarlo mediante customer.get. El guardado valida lectura autorizada y pertenencia del cliente a la empresa; no guarda una copia paralela de su ficha.

Solo se suspende antes de «Continuar al cobro». Una venta creada, cobro parcial o solicitud incierta impide suspender. No se crean pagos ni se descuenta inventario al guardar. El servicio calcula precios, impuestos y existencias al crear la venta; los precios guardados para mostrar no son autoridad.

La recuperación tras reiniciar consulta SQLite. Rehidrata únicamente un turno OPEN ya existente del mismo operador, dispositivo, empresa, sucursal y caja; no abre ni reabre turnos. Si no existe, exige abrir la caja correspondiente. Modificaciones hechas después de recuperar deben guardarse de nuevo en espera antes de cerrar: no hay autosave de cada pulsación. No se acredita recuperación durable de cobros o inventario pendientes por este cambio.

## Decisión e integración

La búsqueda encontró estados DRAFT/SUSPENDED definidos en sales_sales, pero no operaciones de guardar/listar/recuperar carritos ni un escritor de borradores anterior a la valoración. El camino existente sale.create crea una venta numerada, calculada y publicada en outbox; usarlo al pulsar «En espera» adelantaría esos efectos. La migración aditiva 019 guarda exclusivamente el borrador editable de atención. No sustituye sales_sales ni crea otro motor de ventas: al pasar a cobro se llama al mismo CreateSaleUseCase.

Cadena: SalePanel → useCommercialSale → preload/allowlist → contratos y canal existente → CommercialRequestHandler → SqliteWaitingCartStore. CommercialComponent instancia el almacén con la misma base y único escritor local. Los mensajes son cart.waiting.save/list/get/discard. sale.create admite waiting_cart opcional; las peticiones anteriores siguen siendo válidas.

## Integridad y límites

- El servicio deriva tenant, empresa, sucursal, dispositivo y operador de su contexto autenticado. SALES_SALE_CREATE se comprueba en cada operación. No se admite identidad afirmada por el renderer.
- Aislamiento por operador y dispositivo: no es una bandeja compartida entre cajeros.
- Guardado con versión esperada e identidad de reintento. Conflicto explícito si otra ventana actualizó el borrador.
- Crear la venta y consumir el borrador comparten una transacción SQLite. Solo éxito/resultado idempotente lo consume. Repetir la solicitud original recupera la venta; otra clave no genera una segunda venta desde ese borrador.
- Eliminar deja un estado terminal DISCARDED, no borra ventas ni pagos y no permite resucitar el carrito mediante un reintento antiguo. Los registros terminales se conservan como protección frente a reintentos; no hay purga automática nueva.
- Máximo 50 clientes pendientes por operador/dispositivo y 200 líneas por carrito. La lista transmite metadatos; get recupera solo el carrito seleccionado para mantener la respuesta acotada. No hay transferencia entre dispositivos ni sincronización de borradores.
- La asociación se conserva en el borrador y en sales_sales.customer_id al crear la venta. Fiscal permite «Emitir con cliente de la venta»; la emisión sigue siendo explícita y requiere autorización fiscal. Ventas históricas sin cliente conservan NULL. No hay descuentos de carrito. Las reglas comerciales existentes permanecen en el servicio.

## Evidencia observada

312 pruebas desktop, 46 focalizadas del servicio (incluye canal real TCP local, handler de producción y SQLite), 58 de database-sqlite, 298 de contratos, 47 de local-channel aprobadas; cuatro pruebas de local-channel omitidas. TypeScript servicio/renderer y compilación de main aprobados. Build renderer aprobado. Las pruebas de migración reconstruyen bases antiguas y conservan sus filas; no se alteraron migraciones 001–018.

Se observó inicialmente EPERM al escuchar un socket Unix. El arnés Linux pasó a TCP loopback efímero, siguiendo otras pruebas del repositorio; framing, MAC, autorización, handler y base siguen siendo reales. Windows conserva named pipes en el arnés. Esto no acredita SCM ni identidad nativa Windows.

La prueba de interfaz usa transporte simulado; por separado se observa el canal real con efecto en SQLite. No se declara una prueba Electron→servicio completa, QA visual, Android ni producción. El typecheck general desktop que incluye E2E encontró dependencias Playwright ausentes; el typecheck de renderer y la compilación del código main sí pasaron. Dependencias de caché: no se acredita instalación frozen-lockfile.

## Ampliación del 13 de noviembre

Pruebas de renderer y canal real verifican búsqueda/vínculo, guardado y recuperación del customer_id y rechazo de cliente inexistente antes de guardar. La asociación no comparte carritos entre operadores ni acredita sincronización central. La evidencia original de 312 pruebas corresponde al incremento previo; consultar integration-verification-20261110.md para los resultados del incremento actual.

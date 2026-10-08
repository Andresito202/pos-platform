# Identidad de marca — Camacho POS Colombia

## Estado

- Nombre comercial del producto: `Camacho POS Colombia`.
- Identificador técnico interno: `POS Platform` / `pos-platform`.
- Scopes técnicos preservados: `@pos-platform/*`.
- Titular legal / responsable declarado del producto: `CamachoPosColombia SAS`.  
Representante / contacto responsable: `Wilson Andrés Camacho Culma`.  
Domicilio declarado: `Transversal 3A #87B-45 Sur, Bogotá D.C., Colombia`.  
Correo de contacto: `andrescamacho.19@hotmail.com`.  
Teléfono de contacto: `3227506213`.  
NIT: `PENDIENTE DE FORMALIZACIÓN`.
- Antecedentes RUES/SIC: `REQUIRES_OFFICIAL_CLEARANCE`.
- Registro marcario SIC: `NOT_REGISTERED`.
- Registro de software DNDA: `PLANNED`.

La identidad jurídica anterior se incorpora con los datos suministrados por el propietario del proyecto; el NIT permanece pendiente de formalización. La adopción del nombre comercial no equivale a afirmar registro de marca, habilitación DIAN, certificación fiscal, condición SaaS ni readiness productivo.

## Regla de uso

`Camacho POS Colombia` se usa en superficies visibles al cliente y activos comerciales:

- nombre de aplicación e instalador;
- pantalla de acceso y shell visual;
- documentación de producto y manuales;
- sitio web, material comercial y soporte;
- contratos/licencias y documentos de onboarding;
- facturas comerciales emitidas por la empresa titular cuando corresponda;
- comunicaciones de lanzamiento y piloto.

Los identificadores técnicos existentes no se renombran solo por branding:

- repositorio `pos-platform`;
- package root `pos-platform-target`;
- scopes `@pos-platform/*`;
- nombres de schemas, migrations, bounded contexts, eventos o contratos;
- SHAs, branches, PRs y evidencia histórica.

Un rename técnico futuro requiere ADR/cambio separado si existe una necesidad real de compatibilidad o distribución.

## Modelo comercial inicial

El producto no requiere convertirse en SaaS para salir al mercado.

Modelo inicial preferido:

- `LOCAL_PERPETUAL` o `HYBRID` según capacidad contratada;
- licencia por empresa/sede/terminal conforme a contrato;
- instalación local-first;
- soporte y mantenimiento opcional o anual;
- actualizaciones controladas;
- backups/exportación/offboarding definidos;
- servicios centrales mínimos solo cuando una capacidad realmente los requiera.

El modelo comercial no modifica la arquitectura canónica ni crea forks del producto.

## Claims prohibidos hasta evidencia

No usar públicamente sin evidencia aplicable:

- `marca registrada` o símbolo ®;
- `Proveedor Tecnológico DIAN`;
- `certificado por DIAN`;
- `SaaS` como modalidad única;
- `100% productivo`, `production-ready` o equivalentes;
- soporte real de SIIGO/FACTUS/ALEGRA mientras permanezcan `NOT_EVALUATED`;
- certificación de hardware no validado.

## Gate de formalización comercial

Antes del lanzamiento comercial se debe completar, como mínimo:

1. consulta de homonimia/razón social en RUES/Cámara de Comercio;
2. búsqueda de antecedentes marcarios en SIC/SIPI;
3. definición de la persona jurídica titular;
4. solicitud de marca en las clases aplicables;
5. registro declarativo del software ante DNDA;
6. contratos/licencia, privacidad, tratamiento de datos y soporte;
7. definición tributaria y facturación de la empresa;
8. claims comerciales alineados con el estado técnico real.

## Activo de marca

`docs/brand/camacho-pos-colombia-logo.png` — 1521 × 545, RGBA con fondo
transparente. `docs/brand/camacho-pos-colombia-logo-960.png` es la misma imagen
a 960 px para encabezados; el `README.md` usa ésa a 640 px de ancho.

### Cómo se obtuvo, y por qué importa

El original que aportó el propietario es un **JPEG con fondo `(247,247,247)`** —
no blanco — y **84 225 colores distintos** por compresión. Un umbral global de
brillo habría agujereado el relleno plateado de «CAMACHO» y «COLOMBIA», que en
esa zona está a un valor casi idéntico al fondo.

Se quitó el fondo por **conectividad desde los bordes**: sólo desaparece el
fondo que toca el marco, de modo que cualquier zona clara encerrada por el arte
sobrevive. Después se recortó a la caja del contenido.

**Verificado sobre el resultado, no supuesto:** las cuatro esquinas quedan con
alfa 0; el relleno claro de las letras sigue opaco; y las seis regiones claras
restantes se midieron una por una —varianza 27–35 en todas— para confirmar que
son arte (filo cromado de la «C» y relleno de las letras) y **no** fondo plano
residual. Borrarlas habría destruido el logotipo.

### Qué NO se cambió

**Nada del contenido.** Ni el símbolo, ni la tipografía, ni los colores, ni la
bandera, ni el lema «VENDE. CONTROLA. SIGUE OPERANDO.». La única operación fue
quitar el fondo y recortar el margen muerto.

### Observaciones de diseño, para decidir el propietario

No se aplicó ninguna; se dejan registradas porque afectan a cómo se ve el
logotipo en uso real, no a lo que comunica:

1. **El lema es pequeño frente al conjunto.** A 640 px de ancho en el `README`
   queda en torno a 8 px de alto, en el límite de lo legible. Una versión con el
   lema en línea aparte, o sin lema para usos pequeños, lo resolvería.
2. **Las letras claras dependen de su contorno oscuro** para leerse. Se sostiene
   sobre fondo claro y sobre fondo oscuro, que es lo que exige el tema
   automático de GitHub; conviene no retirar ese contorno en variantes futuras.
3. **Falta una marca compacta** (sólo el símbolo «C») para favicon, icono de
   aplicación Electron y barra de tareas. Recortarla del símbolo actual es
   directo y no exige rediseño.

Estas observaciones **no** constituyen registro marcario. Lo dicho arriba sobre
RUES/SIC sigue vigente.

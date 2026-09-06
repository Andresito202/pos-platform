# Gate de pentest con Strix

## Alcance

Este documento define el control materializado por `.github/workflows/security.yml`.

El workflow ejecuta un escaneo de penetración asistido por IA sobre el árbol de
la pull request. **No declara que el producto sea seguro** ni cierra ninguno de
los gates `SEC-G01..SEC-G10`, que siguen `PLANNED`.

## Estado actual: NO CONFIGURADO

El escaneo **no se está ejecutando**. Faltan dos secretos de repositorio:

| Secreto | Qué es |
|---|---|
| `STRIX_LLM` | identificador del modelo que Strix debe usar |
| `LLM_API_KEY` | clave de API del proveedor de ese modelo |

Sin ellos la CLI aborta con código 1 tras instalarse correctamente. Verificado en
el job `Strix AI penetration test` del 2026-09-06: la instalación termina bien y
`strix` sale mostrando su banner de configuración pidiendo claves.

## Por qué el fallo se separó del fallo real

Hasta el 2026-09-06 este control estaba **rojo en el 100 % de las pull
requests** por falta de configuración. Un control que falla siempre por el mismo
motivo administrativo no aporta señal: nadie puede distinguir «Strix encontró
una vulnerabilidad» de «faltan los secretos», y el efecto práctico es que se
aprende a ignorar el rojo — incluido el rojo que sí importa.

El workflow distingue ahora los dos casos:

- **Sin secretos** → el job no falla, pero **emite una anotación de aviso**
  `Strix penetration test NOT RUN` y escribe en el resumen del job, en negrita,
  que no se realizó ningún pentest y que el check en verde **no significa que el
  cambio se haya escaneado**.
- **Con secretos** → se instala y se ejecuta. Un fallo vuelve a significar lo
  único que debe significar: el escaneo encontró algo, o no pudo completarse.

Esto **no relaja el control**. Lo hace legible: antes el rojo no distinguía nada;
ahora el rojo es un hallazgo y el aviso es una configuración pendiente.

## Cómo activarlo

Acción del propietario, en el navegador, no en la terminal:

`Settings` → `Secrets and variables` → `Actions` → `New repository secret`

Se crean los dos secretos de la tabla anterior. En la siguiente pull request el
aviso desaparece y el escaneo se ejecuta.

## Regla que no se relaja

El valor de `LLM_API_KEY` es una credencial y le aplican íntegras las reglas de
`fiscal-adapter-gate.md` §12: nunca en el repositorio, ni en código, ni en
pruebas, ni en documentación, ni en mensajes de commit, ni en descripciones de
PR. Sólo en el almacén de secretos de GitHub Actions. Los **nombres** de los
secretos son públicos; los valores no.

`validate-repository-policy.mjs` escanea patrones de secreto en archivos
rastreados y debe seguir pasando.

## Nota de verificación

La especificación original de esta tarea pedía `strix-ai/strix-action@v1`
autenticado con `secrets.STRIX_TOKEN`. Se verificó contra el repositorio oficial
y contra el listado de la organización `usestrix`: **no existe** ninguna Action
empaquetada `strix-action`. La integración documentada es instalación por script
más CLI, autenticada con `STRIX_LLM` y `LLM_API_KEY`. El workflow sigue la
documentación real, no los parámetros solicitados.

# Ejecución adicional de Electron y bloqueo de plataforma — 2026-10-29

**Se ejecutó el motor Node del Electron real en Linux; Windows sigue sin ejecutor disponible. No es posible dejar únicamente MFA humana pendiente desde este entorno.** La ceremonia humana conserva el último lugar, después de las comprobaciones automáticas Windows.

Fuente de código verificada: `52ab79a7cc55411b343283bc92b3aad89f3910b7`. HEAD remoto inicial `bc9af6b98d5e026e984539fc3047739f93c35860`, con solo documentación posterior a ese código. Se cotejaron los 831 archivos fuente del snapshot. No se modificó código ni se instalaron servicios o identidades.

## Ejecución real

El paquete de Electron resolvió/descargó su ejecutable Linux. Se arrancó ese ejecutable con `ELECTRON_RUN_AS_NODE=1` y devolvió Electron **44.1.1**, Node **24.19.0**, libuv **1.52.1**, plataforma **linux**.

Se ejecutaron las suites canónicas seleccionadas desde ese proceso: transporte SCM con puertos OS simulados, cancelación del canal, cierre del transporte, leases SQLite, criptografía de handoff, frontera del adaptador y cambio de cuenta. Resultado: **74 aprobadas, 0 fallidas y 2 omitidas por Windows**. TCP, criptografía y SQLite son reales; los peers Windows/DPAPI siguen siendo puertos de prueba. No se suman estos casos a los de la entrega anterior porque se solapan.

También se intentó arrancar la entrada gráfica E2E existente `e2e/smoke-entry.mjs`, con el mismo flag de laboratorio root que usa `boot.spec.ts`. Esa entrada tiene un canal doble de prueba y nunca acredita login comercial. El proceso terminó con **SIGTRAP** antes de abrir una ventana: `Missing X server or $DISPLAY`, fallo de inicialización de plataforma y restricciones de D-Bus/sockets. Es un bloqueo de este entorno, no una prueba aprobada de UI ni un defecto funcional demostrado del POS.

No se desactivaron verificaciones de autenticación, autorización o cifrado para superar ese fallo. No se cambió la configuración productiva de Electron. No se utilizó un fallback de almacenamiento de credenciales en texto plano.

## Disponibilidad comprobada

- Solo consta un ejecutor Linux conectado; no se proporcionó un ejecutor o destino Windows autorizado accesible.
- No hay toolchain Windows ni PowerShell, Wine, Docker/Podman, QEMU/KVM o Xvfb disponibles.
- No hay manifiesto cloud configurado que identifique otra máquina autorizada.
- No se activaron GitHub Actions ni se contrataron recursos.

## Pendiente técnico real

1. Disponer de un ejecutor Windows autorizado con SDK/C++, Node y Electron.
2. Compilar el addon real, empaquetarlo con su SHA aprobado y verificarlo en los hosts Node/Electron Windows.
3. Ejecutar la prueba física bajo SCM y el usuario/logon real: DPAPI CurrentUser, SID/logon SID, DACL, handoff, consumo/replay, revocación y reinicios.
4. Ejecutar Electron gráfico con el Service real y la autorización efectiva.
5. Realizar al final la ceremonia humana HTTPS/contraseña/WebAuthn UV/PKCE/DeviceProof/SSA/SAS/RBAC, BUSINESS y GLOBAL por separado.

El procedimiento y runner preparados permanecen en [el cierre G1/G2](windows-g1-g2-closure-2026-10-29.md) y [la entrega física](windows-scm-g1-g2-materialization-2026-10-29.md). Hace falta plataforma Windows accesible para las etapas 2–4; no basta autorización adicional ni repetir pruebas Linux.

**Estado:** Electron Node en Linux probado; GUI Linux bloqueada por entorno; addon/SCM/DPAPI/Electron Windows pendientes; MFA humana pendiente y última. Se conserva `SCM_COMMERCIAL_CHANNEL_IDENTITY_INTEROP_NOT_PROVEN`. Sin certificación productiva ni habilitación comercial.

[Evidencia de invocación, casos y error gráfico](evidence/electron-host-execution-2026-10-29.json).

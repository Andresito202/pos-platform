# Camacho POS — Certificación técnica gratuita y firma opcional de Windows

**Decisión:** no exigir Microsoft Store, certificado Authenticode de pago ni GitHub Actions para desarrollar, certificar técnicamente o distribuir Camacho POS. Mantener el runtime comercial Windows con Electron, `CamachoPOSLocalService`/SCM, SQLite local, identidad y claves, aislamiento y hardware. Nunca retirar componentes para adaptarse a restricciones de una tienda.

## Qué queda aprobado y qué no

- **Certificación técnica interna:** puede hacerse gratis, offline y sobre un checkout limpio. El comprobante identificará commit, lockfile, resultados y SHA-256 de logs. Es *evidencia técnica*, no una autoridad certificadora ni una firma pública.
- **Gate Central aislado:** `tools/operators/windows-central-sync-isolated-gate.ps1 -Run` tiene su propio resultado y usa solamente el PostgreSQL temporal `127.0.0.1:55436`. No se integra automáticamente en el gate estático para evitar Docker, puertos, servicios y efectos laterales inadvertidos.
- **Certificado TLS público:** Let's Encrypt es gratuito para endpoints que demuestren control del dominio, sin implicar ninguna firma de ejecutables.
- **Firma pública Windows:** no hay evidencia de que se pueda firmar gratuitamente el instalador EXE+WinSW comercial actual con un certificado Authenticode público. MSIX de Microsoft Store exige evaluación del empaquetado y capacidad de servicios y no se declarará compatible sin pruebas. Una firma autofirmada **no** implica reputación SmartScreen ni confianza pública.
- **Cierre de decisión:** si una vía gratuita exige desinstalar WinSW, disminuir permisos necesarios, cambiar identidad SCM, desactivar funciones offline o restringir hardware, queda descartada para la versión comercial.

## Gate local sin GitHub Actions

Requisitos: Git en PATH, Node, pnpm y dependencias del workspace ya instaladas. No se instalará nada ni habrá procesos privilegiados.

En PowerShell, desde un árbol limpio, rama `feat/p0-windows-login-install-readiness`:

```powershell
git pull --ff-only
node tools/ci/free-local-certification.mjs
```

Comprueba un HEAD exacto, branch y árbol limpio; ejecuta TypeScript para contracts, device-trust, Postgres, servicio local, escritorio y migraciones, más pruebas nombradas de enrolamiento y sincronización. Se detiene en el primer FAIL; reporta `LOCAL_TECHNICAL_VERIFICATION=PASS|FAIL`.

Los resultados y el comprobante se almacenan en una carpeta nueva bajo el directorio temporal del usuario, por ejemplo `%TEMP%\camacho-pos-free-cert-...`, **fuera del repositorio**. Se genera `receipt.json` y `receipt.json.sha256`. Los logs de los comandos quedan con hashes propios en el recibo.

El campo `external_certificate` permanece `false`; también `installation_certified`, `public_code_signing`, `isolated_postgres_gate_included` y `device_hardware_certified`. El formato impide presentar un PASS de unit tests como certificación externa, de instalación o hardware.

Para certificar el gate aislado por separado, seguir el procedimiento aprobado del script PowerShell y comprobar la salida `CENTRAL-SYNC GATE: VERIFIED`. Guardar el log únicamente en el directorio aislado creado por el operador.

## Reglas de no regresión

1. No usar `git clean`, `git reset --hard`, cambios de ramas automáticos, pruebas contra preproducción ni acciones de SCM.
2. No cambiar el instalador ni el servicio Windows para lograr un PASS.
3. No interpretar un resultado `PASS` de esta herramienta como certificación comercial completa: las pruebas humanas de Windows, instalación, cajón/impresión, seguridad de dispositivo persistente, y capacidad siguen siendo gates separados.
4. Si una prueba deja de pasar tras actualizar el código, fallar el gate y corregir la causa, nunca reducir el esquema o desactivar pruebas para forzar un certificado.

**Criterio de cierre:** informe reproducible sin costo, más gates de integración y pruebas reales según módulo; la firma pública continúa opcional.

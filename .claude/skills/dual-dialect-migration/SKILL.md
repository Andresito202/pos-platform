---
name: dual-dialect-migration
description: Usar al crear o modificar migrations con Kysely en pos-platform, ya que el proyecto usa PostgreSQL 16 central y SQLite/WAL local con migrations físicas separadas por dialecto.
---
# Migrations dual-dialect (Kysely)

Este proyecto NO asume equivalencia automática entre PostgreSQL y SQLite. Cada dialecto tiene
su propia migration física.

Al proponer o generar una migration:
1. Identifica si el cambio aplica a PostgreSQL central, SQLite local, o ambos.
2. Si aplica a ambos, escribe DOS migrations separadas — nunca una sola "genérica".
3. Corre `pnpm test:migrations:postgres` y/o `pnpm test:migrations:sqlite` según corresponda,
   y reporta el resultado real, no el esperado.
4. No marques un dialecto como `INTEGRATED` si el otro sigue en `NONE` — repórtalos por separado.
5. Recuerda: el POS Local Service es el único proceso escritor de SQLite. Ninguna migration ni
   código de aplicación debe abrir SQLite desde el renderer de Electron.

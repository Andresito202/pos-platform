# PENDIENTE: Modulo de Gestion de Usuarios (Frontend)

**Fecha:** 2026-03-09
**Estado:** Pendiente
**Prioridad:** Alta
**Backend:** Ya implementado (endpoint funcional)

---

## Situacion actual

| Componente | Estado |
|---|---|
| `POST /api/auth/register` (crear usuario) | Listo - solo admin |
| `GET /api/auth/me` (ver perfil) | Listo |
| Modelo Usuario con 5 roles | Listo |
| Validacion de username/email duplicado | Listo |
| Pagina `usuarios.html` en frontend | **NO EXISTE** |
| Endpoint para listar usuarios | **NO EXISTE** |
| Endpoint para editar/desactivar usuario | **NO EXISTE** |

---

## Que se necesita construir

### 1. Backend - Nuevos endpoints

| Metodo | Ruta | Descripcion | Acceso |
|---|---|---|---|
| GET | `/api/auth/usuarios` | Listar todos los usuarios | Admin |
| GET | `/api/auth/usuarios/{id}` | Obtener un usuario | Admin |
| PUT | `/api/auth/usuarios/{id}` | Editar usuario (nombre, email, rol) | Admin |
| PATCH | `/api/auth/usuarios/{id}/toggle` | Activar/desactivar usuario | Admin |
| PUT | `/api/auth/usuarios/{id}/password` | Cambiar contrasena de un usuario | Admin |

**Archivo a modificar:** `backend/app/api/auth.py`

**Schemas nuevos necesarios en** `backend/app/schemas/usuario.py`:
- `UsuarioUpdate` (nombre_completo, email, rol - todos opcionales)
- `CambiarPassword` (nueva_password)

---

### 2. Frontend - Pagina `usuarios.html`

**Funcionalidades de la pagina:**

#### Tabla de usuarios
- Columnas: ID, Username, Nombre completo, Email, Rol, Estado (activo/inactivo), Fecha creacion
- Badge de color por rol (admin=rojo, cajero=verde, bodeguero=azul, supervisor=naranja, gerente=morado)
- Badge activo (verde) / inactivo (gris)
- Botones de accion: editar, activar/desactivar

#### Boton "Nuevo Usuario"
- Abre modal con formulario:
  - Username (obligatorio, unico)
  - Email (obligatorio, unico)
  - Contrasena (obligatorio, minimo 8 caracteres)
  - Nombre completo (obligatorio)
  - Rol (selector: admin, cajero, bodeguero, supervisor, gerente)

#### Boton "Editar" por fila
- Abre modal con datos precargados
- Permite cambiar: nombre, email, rol
- NO muestra la contrasena (campo separado)

#### Boton "Activar/Desactivar"
- Confirmacion antes de desactivar
- Un usuario desactivado no puede hacer login

#### Boton "Cambiar Contrasena"
- Abre modal con campo de nueva contrasena
- Solo el admin puede cambiar contrasenas de otros

---

### 3. Agregar al sidebar

**Archivo:** `frontend/static/js/layout.js`

Agregar entrada:
```javascript
{ href: '/usuarios.html', icon: 'bi-person-gear', text: 'Usuarios', roles: ['admin'] },
```

Solo visible para el rol admin.

---

## Roles y lo que ve cada uno (recordatorio)

| Rol | Descripcion | Paginas que ve |
|---|---|---|
| admin | Control total del sistema | TODAS + Usuarios |
| cajero | Atiende clientes, vende | POS, Caja, Productos, Clientes |
| bodeguero | Maneja inventario y recibe mercancia | Categorias, Productos, Proveedores, Compras, Inventario, Mermas |
| supervisor | Supervisa operacion diaria | Casi todo excepto Auditoria y Usuarios |
| gerente | Consulta reportes y auditoria | Reportes, Auditoria, Productos, Inventario |

---

## Ejemplo de uso esperado

```
1. Admin entra al sistema
2. Va a menu "Usuarios"
3. Clic en "Nuevo Usuario"
4. Llena: username=cajero1, nombre=Maria Lopez, email=maria@avicola.local,
   password=********, rol=cajero
5. Guardar
6. Maria puede entrar al sistema con su usuario
7. Maria solo ve: Dashboard, POS, Caja, Productos, Clientes
8. Si Maria se va, el admin la desactiva y ya no puede entrar
```

---

## Archivos a crear/modificar

| Archivo | Accion |
|---|---|
| `frontend/usuarios.html` | CREAR - pagina completa |
| `backend/app/api/auth.py` | MODIFICAR - agregar 5 endpoints |
| `backend/app/schemas/usuario.py` | MODIFICAR - agregar UsuarioUpdate, CambiarPassword |
| `frontend/static/js/layout.js` | MODIFICAR - agregar enlace en sidebar |
| `backend/app/main.py` | SIN CAMBIOS (auth_router ya esta registrado) |

---

## Tiempo estimado de implementacion

- Backend (endpoints + schemas): ~30 minutos
- Frontend (pagina + modales + logica JS): ~45 minutos
- Pruebas y ajustes: ~15 minutos

**Total aproximado: 1 sesion de trabajo**

# Miembros y seguridad

## Roles

Cada miembro de un espacio de trabajo tiene un rol:

| Permiso                                                                 | Viewer | Member | Admin | Owner |
| ----------------------------------------------------------------------- | :----: | :----: | :---: | :---: |
| Ver la Library, el mapa, el impacto y los cambios                       |   ✔    |   ✔    |   ✔   |   ✔   |
| Crear y editar recursos y relaciones, revisar sugerencias, importar     |        |   ✔    |   ✔   |   ✔   |
| Gestionar agentes, tokens de registro e integraciones                   |        |        |   ✔   |   ✔   |
| Invitar miembros, cambiar roles, quitar miembros (no owners)            |        |        |   ✔   |   ✔   |
| Dar o quitar el rol de owner, facturación, borrar el espacio de trabajo |        |        |       |   ✔   |

Un espacio de trabajo siempre conserva al menos un owner. Cualquiera puede
abandonar un espacio de trabajo.

## Invitar personas

**Settings › Members › Invite**: escribe la dirección de correo y el rol. La
persona recibe un correo (si el correo está configurado) y el enlace también
se te muestra a ti, válido durante 7 días. Acepta iniciando sesión o creando
una cuenta con esa misma dirección. Las invitaciones pendientes se pueden
revocar.

## Tu cuenta

**Account & security** (tu nombre, abajo en la barra lateral) incluye:

- **Autenticación en dos pasos** con cualquier aplicación de autenticación
  (TOTP), más **códigos de respaldo** de un solo uso — guárdalos en un lugar
  seguro.
- **Llaves de acceso (passkeys)**: inicia sesión con Windows Hello, Touch
  ID, un móvil o una llave de seguridad, sin contraseña.
- **Métodos de inicio de sesión**: conecta Google o Microsoft (si el
  servidor los tiene activados).
- **Actividad de seguridad reciente**: tus inicios de sesión con hora, IP y
  navegador.
- **Borrar la cuenta**: elimina tus datos de usuario y los espacios de
  trabajo en los que eres el único miembro. Se rechaza mientras seas el
  único owner de un espacio de trabajo con otros miembros — transfiere antes
  la propiedad.

## Exigir 2FA en un espacio de trabajo

Los owners pueden activar **Require two-factor authentication for every
member** en **Settings**. A los miembros sin 2FA se les pide configurarlo
antes de poder abrir el espacio de trabajo.

## Registro de auditoría

**Settings › Audit log** (admins y owners) registra los eventos relevantes
para la seguridad: miembros invitados, incorporados, eliminados o con
cambio de rol; integraciones añadidas, sincronizadas o borradas; agentes
registrados o revocados; ajustes de seguridad, facturación y datos. Cada
entrada muestra quién, qué, cuándo y desde qué IP. Las entradas no se
pueden editar ni borrar y se guardan 365 días.

## Exportar y borrar un espacio de trabajo

- **Export workspace data (JSON)** en **Settings** (admins y owners)
  descarga los recursos, las relaciones confirmadas, las sugerencias, los
  miembros, los agentes, las integraciones (sin credenciales), los cambios y
  el registro de auditoría. Los recursos y las relaciones se pueden importar
  en otro espacio de trabajo. Nunca se incluyen secretos.
- **Delete workspace** (solo el owner) elimina todos sus datos al instante.
  Exporta antes si puedes necesitarlos; no se puede deshacer.

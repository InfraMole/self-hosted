# Inicio de sesión único (SSO)

Permite que las personas de tu organización inicien sesión con tu propio
proveedor de identidad o directorio. Sus grupos del directorio deciden su rol
en el espacio de trabajo, en cada inicio de sesión.

Compatible con:

- **OpenID Connect**: Microsoft Entra ID, Okta, Keycloak, Google Workspace,
  Authentik, Zitadel…
- **SAML 2.0**: ADFS, Shibboleth, Entra ID, Okta, Keycloak…
- **LDAP / Active Directory**: el directorio comprueba la contraseña.

El inicio de sesión único está disponible en todas las ediciones. Solo los
**propietarios** del espacio de trabajo pueden configurarlo; los
administradores pueden verlo.
El servidor necesita `CREDENTIALS_ENCRYPTION_KEY` (la pone el script de
instalación): los secretos de cliente, las claves de firma y las contraseñas
del directorio se guardan cifrados.

## Cómo funciona

1. Una conexión es para **un dominio de correo** (por ejemplo `uni.example`).
2. Demuestras que el dominio es tuyo con un registro DNS. Hasta entonces nadie
   puede iniciar sesión con la conexión.
3. Las personas de ese dominio pulsan **Sign in with SSO** en la página de
   inicio de sesión e introducen su correo de trabajo. InfraMole las envía a
   tu proveedor (o, con LDAP, les pide la contraseña del directorio).
4. En cada inicio de sesión, sus grupos se comparan con tus reglas:
   - gana el rol más alto que coincida (viewer, member o admin);
   - quien no esté en ningún grupo de la lista recibe el rol por defecto que
     elijas, o se le rechaza;
   - quien sale de los grupos pierde el acceso en su siguiente inicio de
     sesión.

Un directorio nunca convierte a nadie en **propietario**, y un inicio de
sesión nunca cambia ni elimina a los propietarios existentes. Las cuentas se
crean en el primer inicio de sesión; no hace falta invitar a nadie.

## Añadir una conexión

**Settings › Single sign-on › Add single sign-on**: elige el protocolo, un
nombre y el dominio de correo.

### OpenID Connect

1. En tu proveedor, crea una aplicación web (cliente confidencial) con la
   **URI de redirección** que InfraMole muestra al guardar:
   `https://<tu InfraMole>/api/auth/sso/callback/<id>`. Puedes guardar
   primero y añadir la URI justo después.
2. En InfraMole introduce la **URL del emisor** (para Entra ID
   `https://login.microsoftonline.com/<tenant-id>/v2.0`; para Keycloak
   `https://<host>/realms/<realm>`), el **client ID** y el **client secret**.
   InfraMole lee el documento de descubrimiento del proveedor al guardar.
3. Haz que el proveedor envíe los grupos en el ID token o en user info, en el
   claim indicado en **Groups claim** (por defecto `groups`). Algunos
   proveedores necesitan un scope adicional (Okta: `groups`).

### SAML 2.0

1. Pega el **XML de metadatos** de tu proveedor en InfraMole y guarda.
2. Abre **Settings for your identity provider** en la conexión y registra en
   tu proveedor el **Entity ID** (audience) y la **Reply URL (ACS)**, o
   simplemente la URL de **metadatos del proveedor de servicio**. InfraMole
   firma sus peticiones; si tu proveedor pide el certificado de firma, cópialo
   de ahí.
3. Envía el correo como NameID (formato email) o en un atributo llamado
   `email`, y los grupos en un atributo (por defecto `groups`; ADFS suele usar
   `http://schemas.microsoft.com/ws/2008/06/identity/claims/groups`). Las
   aserciones deben ir firmadas.

### LDAP / Active Directory

- **Directory server**: `ldaps://dc01.uni.example:636`. `ldap://` sin
  cifrar y los servidores de una red privada solo se permiten si el
  administrador del servidor los incluye en `SSO_TRUSTED_ORIGINS`
  (autoalojado).
- **Service account DN** y **password**: una cuenta de solo lectura que pueda
  buscar usuarios y grupos.
- **Search base DN**: por ejemplo `dc=uni,dc=example`.
- **User filter**: cómo encontrar a una persona por su correo. Por defecto
  `(mail={email})`; en Active Directory es habitual
  `(userPrincipalName={email})`.
- **Groups attribute**: `memberOf` (Active Directory). También funcionan los
  directorios sin `memberOf`: InfraMole busca entonces los grupos cuyo
  `member` es la persona.

Al guardar se comprueba que la cuenta de servicio puede iniciar sesión y
buscar. InfraMole solo busca y se autentica; nunca guarda las contraseñas que
escribe la gente.

Con una autoridad de certificación privada, dásela al servidor con
`NODE_EXTRA_CA_CERTS`.

## Reglas de grupos

Una regla por línea, `grupo = rol`:

```text
IT-Infrastructure = admin
Engineers = member
Service-Desk = viewer
```

Los nombres de grupo se comparan sin distinguir mayúsculas. Los nombres
distinguidos (`CN=IT-Infrastructure,OU=Groups,…`) coinciden por su primera
parte, y las rutas de Keycloak (`/IT/Infrastructure`) por su último segmento.

## Demostrar el dominio

Tras guardar, la conexión muestra un registro DNS **TXT**:

- **Nombre**: `_inframole-sso.<tu dominio>`
- **Valor**: un código único de la conexión

Añádelo en tu proveedor DNS, espera unos minutos y pulsa **Verify domain**.
Un dominio solo puede estar conectado a un espacio de trabajo. Las
instalaciones autoalojadas pueden saltarse el paso DNS para los dominios que
el administrador del servidor incluya en `SSO_TRUSTED_DOMAINS`.

## Solo SSO

Marca **SSO only** para que las personas del dominio no puedan usar una
contraseña: el inicio de sesión con contraseña, el registro y el
restablecimiento de contraseña se rechazan para ese dominio, y la página de
inicio de sesión las envía al inicio de sesión único. Los demás dominios no
se ven afectados. Mantén al menos un propietario que pueda seguir entrando
(por ejemplo con una dirección de otro dominio) por si el proveedor falla.

## Conviene saber

- Con el inicio de sesión único, el segundo factor lo gestiona tu proveedor
  de identidad.
- Desactivar una conexión detiene sus inicios de sesión al momento;
  eliminarla no elimina las cuentas (las personas conservan cualquier otro
  método de inicio de sesión que hayan configurado).
- Todos los cambios en las conexiones y todos los roles que un inicio de
  sesión concede o retira quedan en el registro de auditoría.
- No incluido: aprovisionamiento automático (SCIM), inicio de sesión iniciado
  desde el proveedor (SAML iniciado por el IdP) y cierre de sesión único.

## Ajustes del servidor (autoalojado)

| Variable              | Para qué sirve                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| `SSO_TRUSTED_DOMAINS` | Dominios de correo, separados por comas, que avalas tú: sin prueba DNS.                          |
| `SSO_TRUSTED_ORIGINS` | Proveedores o directorios de tu red o sin TLS, p. ej. `https://idp.corp.lan,ldap://dc01.lan:389` |

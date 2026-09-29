# Configuración

Toda la configuración está en el fichero `.env`, junto a
`docker-compose.yml`. Después de cualquier cambio, aplícalo con:

```sh
docker compose up -d
```

Solo se recrean los servicios cuya configuración ha cambiado. La lista
completa está en [Variables de entorno](/es/docs/reference/environment).

## Dominio y HTTPS

`DEPMAP_DOMAIN` es el nombre público de tu servidor, sin `https://`. Caddy
obtiene y renueva automáticamente un certificado de Let's Encrypt para él y
redirige HTTP a HTTPS.

Para responder también en otros nombres (por ejemplo `www.`), inclúyelos en
`DEPMAP_REDIRECT_HOSTS`, separados por espacios. Cada uno necesita un
registro DNS que apunte al servidor; Caddy los redirige a `DEPMAP_DOMAIN`.

:::warning Cambiar el dominio más adelante
Las llaves de acceso (passkeys) están ligadas al dominio. Si trasladas
InfraMole a otro dominio, los usuarios tendrán que registrar de nuevo sus
llaves de acceso (las contraseñas y el 2FA siguen funcionando).
:::

## Correo electrónico

El correo se usa para verificar direcciones, restablecer contraseñas y
enviar invitaciones.

```sh
SMTP_URL=smtps://user:password@smtp.example.com:465
MAIL_FROM="InfraMole <inframole@example.com>"
```

Usa `smtp://…:587` para STARTTLS. Con el correo configurado, las cuentas
nuevas deben verificar su dirección antes de iniciar sesión. Sin él, no se
envían correos y los enlaces de invitación se muestran en pantalla para que
los compartas.

## Copias de seguridad cifradas

Las copias nocturnas se escriben en `./backups`. Para cifrarlas antes de que
toquen el disco, crea un par de claves [age](https://age-encryption.org)
**en otra máquina** y pon solo la clave pública en `.env`:

```sh
age-keygen -o inframole-backup-key.txt     # guarda este fichero FUERA del servidor
# Public key: age1…
```

```sh
BACKUP_AGE_RECIPIENT=age1...
```

Consulta [Copias de seguridad](/es/docs/operations/backups).

## Iniciar sesión con Google o Microsoft

Opcional. Crea una aplicación OAuth en el proveedor, registra la URI de
redirección e indica el id y el secreto del cliente:

| Proveedor            | URI de redirección                                 | Variables                                                               |
| -------------------- | -------------------------------------------------- | ----------------------------------------------------------------------- |
| Google               | `https://<tu dominio>/api/auth/callback/google`    | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                              |
| Microsoft (Entra ID) | `https://<tu dominio>/api/auth/callback/microsoft` | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` |

`MICROSOFT_TENANT_ID=organizations` solo acepta cuentas profesionales o
educativas; indica el id de tu tenant para limitar el acceso a tu
organización.

## Descargas del agente

El diálogo de registro de agentes muestra comandos que descargan el agente
desde las [versiones oficiales](https://github.com/InfraMole/agent/releases),
**verifican su suma de comprobación** y lo instalan de una vez. Para usar tu
propio espejo, indica en `AGENT_DOWNLOAD_BASE_URL` su dirección
`…/latest/download`.

## Puertos

Caddy publica los puertos 80 y 443. `HTTP_PORT` y `HTTPS_PORT` cambian los
puertos del equipo, pero Let's Encrypt solo funciona en 80/443 — otros
puertos son para instalaciones con `CADDY_TLS=tls internal`.

## Prueba local sin nombre público

Para una evaluación en un portátil o en una red privada:

```sh
DEPMAP_DOMAIN=localhost
CADDY_TLS=tls internal
```

Caddy emite entonces los certificados con su propia autoridad. Los
navegadores avisan hasta que confíes en ella; los agentes de otras máquinas
no confiarán en ella. No lo uses en producción.

## Registro solo por invitación

Por defecto, cualquiera que llegue a tu servidor puede crear una cuenta.
Para que la instalación sea solo por invitación, crea primero tu cuenta y
después indica:

```sh
SIGNUP=closed
```

y ejecuta `docker compose up -d`. A partir de entonces solo las personas que
invites desde **Settings › Members** pueden crear una cuenta (con la
dirección invitada). La primera cuenta de una instalación siempre se puede
crear.

## Licencia Business

Varios espacios de trabajo, soporte prioritario o una licencia comercial en
lugar de la AGPL forman parte de InfraMole Business. Indícala en `.env` y
reinicia:

```sh
EDITION=business
DEPMAP_LICENSE_KEY=dml1....
```

La licencia se verifica sin conexión — InfraMole nunca se comunica con
nosotros. Consulta [Ediciones y límites](/es/docs/reference/editions).

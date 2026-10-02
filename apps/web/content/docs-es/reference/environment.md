# Variables de entorno

Ajustes de las instalaciones autoalojadas, en `.env` junto a
`docker-compose.yml`. Aplica los cambios con `docker compose up -d`.

## Obligatorias

| Variable             | Descripción                                                                                                                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DEPMAP_DOMAIN`      | Nombre DNS público del servidor, sin `https://`.                                                                                                                                                                           |
| `POSTGRES_PASSWORD`  | Contraseña del propietario de la base de datos (migraciones, copias). La rellena `gen-secrets`.                                                                                                                            |
| `APP_DB_PASSWORD`    | Contraseña del rol restringido de base de datos que usa la aplicación. La rellena `gen-secrets`.                                                                                                                           |
| `BETTER_AUTH_SECRET` | Firma las sesiones y cifra los secretos de la autenticación en dos pasos. La rellena `gen-secrets`. **No la cambies** cuando haya usuarios con 2FA: sus códigos dejarían de funcionar (y se cerrarían todas las sesiones). |
| `CRON_SECRET`        | Activa las sincronizaciones programadas de las integraciones y la retención de datos. La rellena `gen-secrets`.                                                                                                            |

## Recomendadas

| Variable                     | Descripción                                                                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SMTP_URL`                   | Correo saliente, p. ej. `smtps://user:password@smtp.example.com:465`. Si se indica, la verificación del correo es obligatoria.                                  |
| `MAIL_FROM`                  | Remitente, p. ej. `InfraMole <inframole@example.com>`. Obligatoria con `SMTP_URL`.                                                                              |
| `CREDENTIALS_ENCRYPTION_KEY` | Cifra los tokens guardados de las integraciones (AES-256-GCM). La rellena `gen-secrets`. **Haz copia**: sin ella hay que volver a introducir los tokens.        |
| `BACKUP_AGE_RECIPIENT`       | Clave pública de age (`age1…`) para cifrar las copias nocturnas.                                                                                                |
| `AGENT_DOWNLOAD_BASE_URL`    | De dónde descargan el agente los comandos de instalación. Por defecto: las versiones oficiales (`https://github.com/InfraMole/agent/releases/latest/download`). |

## Opcionales

| Variable                                                         | Por defecto            | Descripción                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EDITION`                                                        | `community`            | `community` o `business`.                                                                                                                                                                                                                   |
| `DEPMAP_LICENSE_KEY`                                             | —                      | Clave de licencia Business (`dml1.…`), verificada sin conexión.                                                                                                                                                                             |
| `DEPMAP_REDIRECT_HOSTS`                                          | —                      | Nombres adicionales (separados por espacios) que se redirigen a `DEPMAP_DOMAIN`, p. ej. `www.inframole.example.com`.                                                                                                                        |
| `CADDY_TLS`                                                      | vacío (Let's Encrypt)  | `tls internal` para una prueba local con la autoridad de certificación propia de Caddy.                                                                                                                                                     |
| `HTTP_PORT`, `HTTPS_PORT`                                        | `80`, `443`            | Puertos del equipo. Let's Encrypt necesita 80/443.                                                                                                                                                                                          |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                       | —                      | Iniciar sesión con Google.                                                                                                                                                                                                                  |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`                 | —                      | Iniciar sesión con Microsoft.                                                                                                                                                                                                               |
| `MICROSOFT_TENANT_ID`                                            | `organizations`        | `organizations`, `common` o el id de tu tenant.                                                                                                                                                                                             |
| `FEEDBACK_EMAIL`                                                 | —                      | Muestra un botón de Feedback; los mensajes se envían a esta dirección (necesita SMTP).                                                                                                                                                      |
| `SIGNUP`                                                         | `open`                 | `closed` hace que la instalación sea solo por invitación: solo pueden registrarse la primera cuenta y quienes invites.                                                                                                                      |
| `INTEGRATIONS_PRIVATE_NETWORKS`                                  | —                      | Redes privadas a las que pueden llegar las integraciones de Proxmox, TrueNAS y Synology, p. ej. `192.168.1.0/24,10.0.10.0/24` ([Fuentes locales](/es/docs/manual/integrations#fuentes-locales)). Loopback y link-local se rechazan siempre. |
| `CRON_EVERY_SECONDS`                                             | `900`                  | Cada cuánto se ejecutan las tareas programadas.                                                                                                                                                                                             |
| `BACKUP_KEEP_DAYS`                                               | `14`                   | Días de copias nocturnas que se conservan en `./backups`.                                                                                                                                                                                   |
| `INFRAMOLE_VERSION`                                              | la versión del paquete | Etiqueta de imagen que se ejecuta. Cámbiala para actualizar o volver atrás.                                                                                                                                                                 |
| `CREDENTIALS_KEY_VERSION`, `CREDENTIALS_ENCRYPTION_KEY_PREVIOUS` | `1`, —                 | Solo mientras se rota la clave de credenciales.                                                                                                                                                                                             |

## Rotar la clave de credenciales

1. Mueve la clave actual a `CREDENTIALS_ENCRYPTION_KEY_PREVIOUS`.
2. Pon una clave nueva en `CREDENTIALS_ENCRYPTION_KEY`
   (`openssl rand -base64 32`) y aumenta `CREDENTIALS_KEY_VERSION`.
3. `docker compose up -d`. Cada integración se vuelve a cifrar con la clave
   nueva en su siguiente sincronización.
4. Cuando todas las integraciones se hayan sincronizado una vez, elimina
   `CREDENTIALS_ENCRYPTION_KEY_PREVIOUS`.

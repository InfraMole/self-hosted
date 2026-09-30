# nginx, Apache y bases de datos en Linux

En servidores Linux el agente puede informar de lo que se ejecuta dentro:
los **sitios de nginx y Apache** (activado por defecto) y las **bases de
datos de PostgreSQL y MySQL / MariaDB** (desactivado hasta que lo actives).
Aparecen en la Library como aplicaciones y bases de datos que **se ejecutan
en** el servidor, igual que IIS y SQL Server en Windows
([IIS y SQL Server](/es/docs/agent/windows-workloads)).

Necesitan el agente **0.3.0** o posterior y un servidor InfraMole **0.8.0**
o posterior. Un servidor anterior no los recibe.

## Qué se envía

| Carga de trabajo | Se envía                                                                                                  | Nunca se lee                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Sitios de nginx  | `server_name` y `listen` de cada bloque `server` (de `/etc/nginx/nginx.conf` y sus includes)              | Certificados, claves, locations, upstreams ni nada más        |
| Sitios de Apache | `ServerName`, `ServerAlias`, los puertos de cada `<VirtualHost>` y si usa TLS                             | Rutas de certificados y claves, reglas de reescritura ni nada más |
| PostgreSQL       | Nombres de las bases de datos de cada clúster local (sin las de sistema)                                  | Tablas, datos, roles ni tamaños                               |
| MySQL / MariaDB  | Nombres de las bases de datos (sin las de sistema)                                                        | Tablas, datos, usuarios ni tamaños                            |

Un sitio que redirige de HTTP a HTTPS (dos bloques `server` con el mismo
nombre) es un único sitio con ambos puertos. Se recogen una vez por hora;
ejecuta `sudo inframole-agent dry-run` para ver exactamente qué se enviaría.

## Activar las bases de datos

El agente inicia sesión por el socket local **con su propio usuario del
sistema (root)** — no se guarda ninguna contraseña, y si el servidor pide
una, el agente no insiste (anota un aviso).

:::steps

### Permite que el usuario del agente inicie sesión

:::tabs
@tab PostgreSQL

Crea un rol para `root`; la autenticación `peer` por defecto para las
conexiones locales deja entrar al agente. El rol no necesita privilegios:
cualquier rol puede listar los nombres de las bases de datos.

```sh
sudo -u postgres createuser root
```

@tab MySQL / MariaDB

En los paquetes de Debian y Ubuntu, `root` ya inicia sesión con
autenticación por socket — no hay que hacer nada. Si no:

```sql
-- MariaDB
ALTER USER root@localhost IDENTIFIED VIA unix_socket;
-- MySQL
INSTALL PLUGIN auth_socket SONAME 'auth_socket.so';
CREATE USER 'root'@'localhost' IDENTIFIED WITH auth_socket;
```

Si en tu servidor `root` necesita contraseña, déjalo así: crea una cuenta
aparte con autenticación por socket y con el nombre del usuario del sistema
con el que se ejecuta el agente.

:::

### Actívalas en la configuración del agente

Edita `/etc/inframole/agent.json` con `sudo` y añade una sección
`collectors` junto a las claves existentes:

```json
{
  "collectors": {
    "workloads": { "postgresql": true, "mysql": true }
  }
}
```

### Comprueba y reinicia

```sh
sudo inframole-agent dry-run --window 2s
sudo systemctl restart inframole-agent
```

:::

## Cómo aparecen

`shop.example.com (LIN01)` (aplicación, etiqueta `nginx`),
`intranet (LIN01)` (etiqueta `apache`), `orders (LIN01)` (base de datos,
etiqueta `postgresql`), `wordpress (LIN01)` (etiqueta `mysql`); un segundo
clúster de PostgreSQL muestra su puerto: `reports (LIN01\5433)`. Empiezan
como **Discovered** y pasan a **Stale** si desaparecen. Las conexiones a un
puerto en el que solo escucha un sitio se sugieren hacia ese sitio; las de
las bases de datos siguen apuntando al servidor.

## Desactivar los sitios web

```json
{
  "collectors": {
    "workloads": { "webServers": false }
  }
}
```

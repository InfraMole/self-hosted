# nginx, Apache, Docker y bases de datos en Linux

En servidores Linux el agente puede informar de lo que se ejecuta dentro:
los **sitios de nginx y Apache** (activado por defecto) y las **bases de
datos de PostgreSQL y MySQL / MariaDB** (desactivado hasta que lo actives),
además de **HAProxy** y los **contenedores Docker** (activados por defecto).
Aparecen en la Library como aplicaciones y bases de datos que **se ejecutan
en** el servidor, igual que IIS y SQL Server en Windows
([IIS y SQL Server](/es/docs/agent/windows-workloads)).

Necesitan el agente **0.3.0** o posterior y un servidor InfraMole **0.8.0**
o posterior. Un servidor anterior no los recibe.

## Qué se envía

| Carga de trabajo | Se envía                                                                                                | Nunca se lee                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Sitios de nginx  | `server_name` y `listen` de cada bloque `server`; destinos de `*_pass` (host:puerto)                    | Certificados, claves, cabeceras ni nada más      |
| Sitios de Apache | `ServerName`, `ServerAlias`, puertos, TLS; destinos de `ProxyPass` / balanceadores (host:puerto)        | Rutas de certificados y claves ni nada más       |
| HAProxy          | Cada `frontend` / `listen`: puertos y servidores de sus backends (host:puerto)                          | Certificados, credenciales de stats, ACLs        |
| PostgreSQL       | Nombres de las bases de datos de cada clúster local (sin las de sistema)                                | Tablas, datos, roles ni tamaños                  |
| MySQL / MariaDB  | Nombres de las bases de datos (sin las de sistema)                                                      | Tablas, datos, usuarios ni tamaños               |
| Docker           | Contenedores: nombre, imagen, estado, puertos publicados, proyecto / servicio / `depends_on` de Compose | Variables de entorno, volúmenes, otras etiquetas |

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

## Proxies inversos

`proxy_pass` de nginx (y `fastcgi_pass`, `grpc_pass`… con sus bloques
`upstream`), `ProxyPass`, balanceadores y `RewriteRule [P]` de Apache, y los
backends de HAProxy le dicen a InfraMole **a dónde reenvía cada sitio** —
solo host y puerto. InfraMole **sugiere** entonces "el sitio depende de X":

- `127.0.0.1:3000` → lo que en el mismo servidor publica el puerto 3000 (un
  contenedor Docker, por ejemplo);
- una IP → el servidor o la VM que la tiene;
- un nombre → el recurso con ese nombre o nombre de equipo.

Los destinos que no se pueden emparejar se omiten. Revisa las sugerencias
como cualquier otra. Necesita el agente **0.6.0** y el servidor **0.13.0**.

## Contenedores Docker

Si Docker corre en el servidor, el agente lee la **lista de contenedores**
del socket local de Docker (activado por defecto; `"docker": false` en
`collectors.workloads` lo desactiva). Nunca inspecciona contenedores, así
que **las variables de entorno nunca se leen**, y de las etiquetas solo se
quedan el proyecto / servicio / `depends_on` de Compose y los nombres de
host de las rutas de Traefik o Caddy.

- Cada contenedor es un recurso que se ejecuta en el servidor: **base de
  datos** para imágenes de bases de datos (PostgreSQL, MySQL, MariaDB, SQL
  Server, MongoDB, Redis…), **contenedor** para el resto, con la versión de
  la imagen y los puertos publicados. Los servicios de Compose conservan su
  identidad cuando se recrean los contenedores.
- `depends_on` de Compose → _depends on_ sugerido.
- Una ruta de Traefik / Caddy ``Host(`shop.example.com`)`` → el dominio
  _depends on_ el contenedor, que queda _exposed through_ el proxy.
- Las conexiones a un puerto publicado se sugieren hacia ese contenedor.

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

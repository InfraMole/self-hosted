# Actualizar

Las versiones de InfraMole se publican como un nuevo paquete y nuevas
imágenes. Al actualizar, las migraciones de la base de datos se aplican
automáticamente antes de arrancar la nueva versión.

:::steps

### Lee las notas de la versión

Revisa [la página de versiones](https://github.com/InfraMole/self-hosted/releases)
por si algo requiere atención (por ejemplo, un ajuste nuevo).

### Haz una copia de seguridad

```sh
docker compose exec backup sh -c 'pg_dump -h db -U depmap -d depmap -Fc > /backups/pre-upgrade-$(date -u +%Y%m%dT%H%M%SZ).dump'
```

### Descarga el nuevo paquete

Tu `.env` y `backups/` no forman parte del paquete, así que se conservan.

:::tabs
@tab Linux / macOS

```sh
cd /opt/inframole
curl -fsSLO https://github.com/InfraMole/self-hosted/releases/latest/download/inframole-self-hosted.tar.gz
curl -fsSLO https://github.com/InfraMole/self-hosted/releases/latest/download/inframole-self-hosted.tar.gz.sha256
sha256sum -c inframole-self-hosted.tar.gz.sha256
tar xzf inframole-self-hosted.tar.gz --strip-components=1
```

@tab Windows

```powershell
Set-Location C:\InfraMole
$base = "https://github.com/InfraMole/self-hosted/releases/latest/download"
Invoke-WebRequest "$base/inframole-self-hosted.tar.gz" -OutFile inframole-self-hosted.tar.gz
Invoke-WebRequest "$base/inframole-self-hosted.tar.gz.sha256" -OutFile inframole-self-hosted.tar.gz.sha256
$expected = (Get-Content .\inframole-self-hosted.tar.gz.sha256).Split(" ")[0]
if ((Get-FileHash .\inframole-self-hosted.tar.gz -Algorithm SHA256).Hash -ne $expected) { throw "Checksum mismatch" }
tar -xzf inframole-self-hosted.tar.gz --strip-components=1
```

:::

Compara `.env.example` con tu `.env` por si hay ajustes opcionales nuevos.

### Descarga las imágenes y reinicia

```sh
docker compose pull
docker compose up -d
docker compose ps
```

### Borra las imágenes antiguas

Cada versión descarga imágenes nuevas (unos 700 MB) y las antiguas se quedan
en el disco hasta que las borras. Tras unas cuantas actualizaciones pueden
llenar un servidor pequeño, y el siguiente `docker compose pull` falla con
_no space left on device_. Cuando la nueva versión ya esté funcionando:

```sh
docker image prune -af
```

Solo borra imágenes que ningún contenedor usa; la versión en marcha se
conserva. `docker system df` muestra cuánto ocupan las imágenes.

:::

Si una descarga falla con _no space left on device_, tu versión actual sigue
funcionando (`up -d` no llegó a ejecutarse): ejecuta `docker image prune -af`
y vuelve a descargar.

## Qué versión está funcionando

**Settings › Workspace › InfraMole version**, o en el servidor
`docker compose images web`. Para que Ajustes te avise cuando haya una
versión nueva, pon `UPDATE_CHECK=true` en `.env` (una petición anónima a
GitHub al día; no se envía nada de tu instalación).

## Fijar una versión o volver atrás

El paquete fija sus imágenes a su versión. Para usar una versión concreta,
indícala en `.env` y reinicia:

```sh
INFRAMOLE_VERSION=0.1.0
```

No se admite volver a una versión anterior después de que su base de datos
se haya migrado hacia delante: en su lugar, restaura la copia hecha antes de
actualizar (consulta [Copias de seguridad](/es/docs/operations/backups)).

## Agentes

Los agentes siguen funcionando tras actualizar el servidor. Los agentes
0.4.0 y posteriores pueden actualizarse solos si lo activas
([Gestionar y desinstalar › Actualizaciones](/es/docs/agent/manage#actualizaciones));
los anteriores se actualizan ejecutando de nuevo el comando de instalación
desde **Settings › Agents › New enrollment token** — la misma máquina se
vuelve a registrar, sin crear duplicados.

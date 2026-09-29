# Instalar en Windows

InfraMole funciona en Windows 10 y 11 con **Docker Desktop** y el motor de
WSL 2. Es una buena opción para evaluarlo y para equipos pequeños. Para un
servidor de producción que deba funcionar sin supervisión, es mejor Linux
(una máquina virtual Linux en Hyper-V sirve — consulta
[Windows Server](#windows-server)).

:::note Licencia de Docker Desktop
Docker Desktop es gratuito para uso personal, educación y pequeñas empresas
(menos de 250 empleados y menos de 10 millones de USD de facturación). Las
organizaciones más grandes necesitan una suscripción de pago de Docker.
:::

:::steps

### Instala Docker Desktop

1. Activa la virtualización en la BIOS/UEFI si no lo está.
2. Abre **PowerShell como administrador** e instala WSL 2:

   ```powershell
   wsl --install
   ```

   Reinicia cuando te lo pida.

3. Descarga e instala [Docker Desktop](https://www.docker.com/products/docker-desktop/)
   y deja marcada la opción **Use WSL 2 based engine**.
4. En Docker Desktop › **Settings › General**, activa **Start Docker Desktop
   when you sign in**.
5. Compruébalo en una nueva ventana de PowerShell:

   ```powershell
   docker compose version
   ```

### Libera los puertos 80 y 443

Caddy necesita los puertos 80 y 443 para HTTPS. En Windows suelen estar
ocupados por **IIS** u otro servidor web. Compruébalo:

```powershell
Get-NetTCPConnection -LocalPort 80,443 -State Listen -ErrorAction SilentlyContinue |
  Select-Object LocalPort, OwningProcess, @{n="Process";e={(Get-Process -Id $_.OwningProcess).Name}}
```

Si no aparece nada, están libres. Si los usa IIS, instala InfraMole en otra
máquina o quita los enlaces (bindings) de los sitios de IIS en 80/443.

### Abre el cortafuegos

En PowerShell como administrador:

```powershell
New-NetFirewallRule -DisplayName "InfraMole HTTP"  -Direction Inbound -Protocol TCP -LocalPort 80  -Action Allow
New-NetFirewallRule -DisplayName "InfraMole HTTPS" -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow
```

Tu router o el cortafuegos de tu proveedor cloud también deben redirigir los
puertos 80/443 a esta máquina, y tu nombre DNS debe apuntar a su dirección
pública.

### Descarga InfraMole

```powershell
New-Item -ItemType Directory -Force C:\InfraMole | Out-Null
Set-Location C:\InfraMole
$base = "https://github.com/InfraMole/self-hosted/releases/latest/download"
Invoke-WebRequest "$base/inframole-self-hosted.tar.gz" -OutFile inframole-self-hosted.tar.gz
Invoke-WebRequest "$base/inframole-self-hosted.tar.gz.sha256" -OutFile inframole-self-hosted.tar.gz.sha256
$expected = (Get-Content .\inframole-self-hosted.tar.gz.sha256).Split(" ")[0]
if ((Get-FileHash .\inframole-self-hosted.tar.gz -Algorithm SHA256).Hash -ne $expected) { throw "Checksum mismatch: do not use this file." }
tar -xzf inframole-self-hosted.tar.gz --strip-components=1
```

`tar` viene incluido en Windows 10 y 11. La carpeta contiene ahora
`docker-compose.yml`, `Caddyfile`, `.env.example` y `scripts\`.

### Configura

```powershell
Copy-Item .env.example .env
powershell -ExecutionPolicy Bypass -File .\scripts\gen-secrets.ps1 .env
notepad .env
```

`gen-secrets.ps1` rellena todas las contraseñas y claves vacías. En el Bloc
de notas indica al menos `DEPMAP_DOMAIN` (tu nombre DNS, sin `https://`) y
guarda. Se recomienda configurar el correo (`SMTP_URL`, `MAIL_FROM`) y las
copias cifradas (`BACKUP_AGE_RECIPIENT`) — consulta
[Configuración](/es/docs/installation/configuration).

:::warning Guarda una copia de .env
Guarda `.env` en tu gestor de contraseñas. Sin `CREDENTIALS_ENCRYPTION_KEY`
no se pueden descifrar las credenciales guardadas de las integraciones.
:::

### Arranca

```powershell
docker compose up -d
docker compose ps
```

El primer arranque descarga las imágenes, aplica las migraciones de la base
de datos y solicita el certificado. En más o menos un minuto todos los
servicios deberían estar `running` (web: `healthy`).

### Comprueba que funciona

```powershell
Invoke-RestMethod https://inframole.example.com/api/health
```

La respuesta muestra `status: ok`. Después abre
`https://<tu dominio>/sign-up`, crea la primera cuenta y tu espacio de
trabajo.

:::

:::note Docker Desktop y los reinicios
Los contenedores se reinician solos, pero solo cuando Docker Desktop está en
marcha — y en Windows 10/11 eso ocurre cuando un usuario inicia sesión. Para
un servidor que deba sobrevivir a reinicios sin que nadie inicie sesión, usa
Linux.
:::

## Windows Server

Docker Desktop no es compatible con Windows Server. En su lugar, crea una
pequeña máquina virtual Linux (Hyper-V: **New › Quick Create**, o cualquier
ISO de Ubuntu Server), dale 2 GB de RAM y 20 GB de disco, y sigue
[Instalar en Linux](/es/docs/installation/linux). Las propias máquinas
Windows se cubren con el [agente para Windows](/es/docs/agent/install).

## Ejecutar los scripts de ayuda

`restore.sh` y `db-shell.sh` son scripts de shell. En Windows ejecútalos
desde **WSL** (abre _Ubuntu_ en el menú Inicio, `cd /mnt/c/InfraMole`) o
desde **Git Bash** — Docker Desktop deja `docker` disponible en ambos. Las
copias y su restauración se describen en
[Copias de seguridad](/es/docs/operations/backups).

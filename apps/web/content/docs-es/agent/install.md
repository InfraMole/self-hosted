# Instalar el agente

Instala `inframole-agent` en cada servidor que quieras mapear. Necesitas ser
**admin** u **owner** del espacio de trabajo para crear tokens de registro.

:::steps

### Crea un token de registro

En InfraMole abre **Settings › Agents › New enrollment token**. Dale un
nombre (por ejemplo `datacenter-1`), elige cuánto tiempo es válido (7 días
por defecto) y, si quieres, cuántos agentes pueden usarlo.

El diálogo muestra el token **una sola vez**, con los comandos de
instalación listos para Windows y Linux. Un token sirve para registrar
muchos servidores.

### Comprueba qué se enviaría (opcional)

Antes de instalar nada, puedes descargar el binario (consulta
[Descarga manual](#descarga-manual)) y mostrar el informe exacto que
enviaría. No sale nada de la máquina y no se instala nada:

:::tabs
@tab Windows

```powershell
.\inframole-agent.exe dry-run
```

@tab Linux

```sh
./inframole-agent dry-run
```

:::

### Descarga, verifica e instala

Ejecuta en el servidor los comandos del diálogo. Dejan el binario en una
ubicación permanente, **se detienen si la suma de comprobación no
coincide**, registran la máquina e instalan el servicio. Son así:

:::tabs
@tab Windows
Abre **PowerShell como administrador**:

```powershell
$dir = "$env:ProgramFiles\InfraMole"; New-Item -ItemType Directory -Force $dir | Out-Null
Set-Location $dir
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "amd64" }
$file = "inframole-agent_windows_$arch.exe"
$base = "https://github.com/InfraMole/agent/releases/latest/download"
Invoke-WebRequest "$base/$file" -OutFile inframole-agent.exe
Invoke-WebRequest "$base/SHA256SUMS" -OutFile SHA256SUMS
$expected = Get-Content SHA256SUMS | ForEach-Object { $h, $n = $_ -split '\s+\*?', 2; if ($n -eq $file) { $h } }
if (-not $expected -or (Get-FileHash inframole-agent.exe -Algorithm SHA256).Hash -ne $expected) { Remove-Item inframole-agent.exe; throw "Checksum mismatch: do not run this file." }
$env:INFRAMOLE_ENROLLMENT_TOKEN = "<token del diálogo>"
& "$dir\inframole-agent.exe" install --server https://inframole.example.com
```

El binario queda en `C:\Program Files\InfraMole` y se ejecuta como el
servicio de Windows **inframole-agent** (LocalSystem, inicio automático). Su
configuración está en `C:\ProgramData\InfraMole\agent.json`, legible solo
por SYSTEM y los administradores.
@tab Linux
Con `sudo` (o como root):

```sh
cd "$(mktemp -d)"
ARCH=$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')
BASE=https://github.com/InfraMole/agent/releases/latest/download
curl -fsSLO "$BASE/inframole-agent_linux_$ARCH" -O "$BASE/SHA256SUMS"
sha256sum --ignore-missing -c SHA256SUMS && sudo install -m 0755 "inframole-agent_linux_$ARCH" /usr/local/bin/inframole-agent
sudo INFRAMOLE_ENROLLMENT_TOKEN=<token del diálogo> /usr/local/bin/inframole-agent install --server https://inframole.example.com
```

El binario queda en `/usr/local/bin/inframole-agent` y se ejecuta como la
unidad de systemd **inframole-agent** (habilitada, se reinicia sola). Su
configuración está en `/etc/inframole/agent.json` (modo 0600).
:::

Pasar el token mediante `INFRAMOLE_ENROLLMENT_TOKEN` lo mantiene fuera del
historial de la shell y de la lista de procesos.

### Confirma que está informando

:::tabs
@tab Windows

```powershell
& "$env:ProgramFiles\InfraMole\inframole-agent.exe" status
```

@tab Linux

```sh
sudo inframole-agent status
```

:::

En menos de un minuto el servidor aparece en **Settings › Agents** y en la
Library como **Discovered**. Las conexiones se convierten en sugerencias
tras un par de informes.

:::

:::tip Muchos servidores
Usa el mismo token en todos (indica **Max agents** si quieres un límite) y
tus herramientas habituales — GPO, Intune, Ansible, bucles SSH — para
ejecutar los mismos comandos. La instalación es idempotente: ejecutarla otra
vez en una máquina ya registrada la vuelve a registrar sin crear un equipo
duplicado.
:::

## Descarga manual

Los binarios para Windows y Linux (x64 y ARM64), `SHA256SUMS` y su firma de
Sigstore están en la
[página de versiones del agente](https://github.com/InfraMole/agent/releases).
Verifícalos a mano con:

```sh
sha256sum --ignore-missing -c SHA256SUMS
```

## Cortafuegos y proxies

El agente solo necesita HTTPS saliente hacia tu dirección de InfraMole. No
sigue redirecciones y siempre verifica el certificado del servidor (TLS
1.2+).

Detrás de un proxy HTTP, usa las variables estándar `HTTPS_PROXY` y
`NO_PROXY`. Indícalas para el servicio:

:::tabs
@tab Windows
Como administrador, crea una variable para toda la máquina y reinicia el
servicio:

```powershell
[Environment]::SetEnvironmentVariable("HTTPS_PROXY", "http://proxy.example.com:3128", "Machine")
Restart-Service inframole-agent
```

Si el servicio no la recoge, reinicia Windows una vez.
@tab Linux

```sh
sudo systemctl edit inframole-agent
# añade:
# [Service]
# Environment=HTTPS_PROXY=http://proxy.example.com:3128
sudo systemctl restart inframole-agent
```

:::

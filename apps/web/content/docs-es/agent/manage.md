# Gestionar y desinstalar el agente

## Comprobar el estado

:::tabs
@tab Windows

```powershell
& "$env:ProgramFiles\InfraMole\inframole-agent.exe" status
Get-Service inframole-agent
```

@tab Linux

```sh
sudo inframole-agent status
systemctl status inframole-agent
```

:::

`status` muestra el servidor, el id del agente y si el servicio está en
marcha. En InfraMole, **Settings › Agents** lista todos los agentes con su
último informe.

## Registros (logs)

:::tabs
@tab Windows
Visor de eventos › **Registros de Windows › Aplicación**, origen
`inframole-agent`, o bien:

```powershell
Get-WinEvent -FilterHashtable @{ LogName = "Application"; ProviderName = "inframole-agent" } -MaxEvents 20
```

@tab Linux

```sh
journalctl -u inframole-agent -n 50 --no-pager
```

:::

## Ejecutar una vez en primer plano

Útil para ver los errores directamente (detén antes el servicio):

:::tabs
@tab Windows

```powershell
Stop-Service inframole-agent
& "$env:ProgramFiles\InfraMole\inframole-agent.exe" run --once --config C:\ProgramData\InfraMole\agent.json
Start-Service inframole-agent
```

@tab Linux

```sh
sudo systemctl stop inframole-agent
sudo inframole-agent run --once
sudo systemctl start inframole-agent
```

:::

## Actualizaciones

El agente **0.4.0** y posteriores pueden actualizarse solos — solo si lo
activas en su configuración (`/etc/inframole/agent.json` o
`C:\ProgramData\InfraMole\agent.json`):

```json
{ "autoUpdate": true }
```

Más o menos una vez al día el agente consulta las
[versiones oficiales](https://github.com/InfraMole/agent/releases). Solo
instala una versión más nueva si está **firmada con la clave de InfraMole
que lleva el propio agente** y el fichero descargado coincide con ella; nunca
vuelve a una versión anterior. El servidor InfraMole no puede provocar una
actualización ni elegir de dónde viene. La versión anterior se conserva hasta
que la nueva envía su primer informe; si la nueva no consigue informar tras
tres arranques, el agente vuelve a poner la anterior por sí solo.

Para actualizar ahora (o solo comprobarlo), como administrador / root:

:::tabs
@tab Windows

```powershell
& "$env:ProgramFiles\InfraMole\inframole-agent.exe" update --check
& "$env:ProgramFiles\InfraMole\inframole-agent.exe" update
```

@tab Linux

```sh
sudo inframole-agent update --check
sudo inframole-agent update
```

:::

Los agentes anteriores a la 0.4.0 se actualizan ejecutando de nuevo el
comando de instalación (**Settings › Agents › New enrollment token**).

## Revocar un agente

En **Settings › Agents**, revoca el agente. Sus informes se rechazan al
instante; el equipo sigue en la Library (pasa a **Stale** tras tres
intervalos sin informar) con todo su historial. Revocar es también lo que
debes hacer si una máquina se pierde o se ve comprometida.

Ahí también se puede revocar un token de registro; los agentes ya
registrados siguen funcionando.

## Volver a registrar

Ejecutar de nuevo el comando de instalación en la misma máquina la vuelve a
registrar: se reutiliza el mismo agente (la máquina se reconoce por su id de
máquina) y recibe una credencial nueva. No se crea un equipo duplicado.

## Desinstalar

:::tabs
@tab Windows
En PowerShell como administrador:

```powershell
& "$env:ProgramFiles\InfraMole\inframole-agent.exe" uninstall
Remove-Item -Recurse "$env:ProgramFiles\InfraMole"
```

@tab Linux

```sh
sudo inframole-agent uninstall
sudo rm /usr/local/bin/inframole-agent
```

:::

`uninstall` detiene y elimina el servicio y borra su configuración
(`--keep-config` la conserva). **No** revoca el agente en el servidor —
revócalo en **Settings › Agents** para que su credencial no pueda volver a
usarse.

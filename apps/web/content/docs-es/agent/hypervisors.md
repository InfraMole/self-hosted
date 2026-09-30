# Hipervisores: vCenter, Hyper-V y XCP-ng

Un agente también puede informar de los **hosts y máquinas virtuales** de
un hipervisor, y de qué host ejecuta cada VM:

- **VMware vCenter o ESXi**, con un usuario de vSphere de solo lectura;
- **Hyper-V**, las VM del equipo Windows donde corre el agente;
- **XCP-ng**, a través de **Xen Orchestra**, con el token de un usuario que
  solo puede ver.

Estas plataformas están en tu red interna, así que es el agente — no el
servidor de InfraMole — quien las consulta. Las credenciales se quedan en
ficheros de esa máquina: el servidor no puede activar un colector, cambiar
su dirección ni leer sus credenciales.

Qué se guarda de cada host: nombre, clúster o pool, estado de conexión y
versión. De cada VM: nombre, host, estado de encendido, vCPU, memoria,
sistema operativo del invitado, su nombre de equipo y sus direcciones IP.
Discos, snapshots, redes, consolas y todo lo demás nunca se leen.

:::note Preview
El colector de vCenter está verificado contra el simulador de vSphere de
VMware (`vcsim`), que implementa la misma API; Hyper-V y Xen Orchestra
están hechos a partir de su documentación. Ninguno se ha comprobado aún con
un sistema en producción: ejecuta primero el dry-run de abajo, y avísanos si
algo no cuadra. Necesita el agente 0.5.0 o posterior.
:::

:::steps

### Crea una cuenta de solo lectura

:::tabs
@tab vCenter / ESXi

**vCenter** (vSphere Client):

1. **Administration › Single Sign On › Users and Groups › Users › Add**:
   usuario `inframole` en `vsphere.local`.
2. **Administration › Access Control › Global Permissions › Add**: ese
   usuario, rol **Read-only**, con **Propagate to children** marcado.

**ESXi independiente** (Host Client): **Manage › Security & users › Users ›
Add user**, y después **Host › Actions › Permissions › Add user** con el rol
**Read-only**.
@tab Hyper-V

No hay que crear nada: el servicio del agente corre como Local System, que
puede leer Hyper-V. El módulo de PowerShell de Hyper-V debe estar instalado
en el host (viene con las herramientas de administración de Hyper-V; en
Windows Server: `Install-WindowsFeature Hyper-V-PowerShell`).
@tab Xen Orchestra

1. En Xen Orchestra: **Settings › Users › Create**: un usuario con permiso
   **User** (no Admin).
2. **Settings › ACLs**: dale a ese usuario el rol **Viewer** sobre tus
   pools.
3. Entra con ese usuario y crea un token, por ejemplo con
   `xo-cli create-token https://xo.lan inframole@corp.local`.

Los tokens caducan (`maxTokenValidity` de Xen Orchestra): crea uno nuevo
antes de esa fecha.
:::

### Guarda el secreto en el equipo del agente

El fichero contiene solo el secreto, en una línea: la contraseña de vCenter
o el token de Xen Orchestra. Hyper-V no necesita fichero.

:::tabs
@tab Linux

```sh
sudo sh -c 'umask 077; cat > /etc/inframole/vcenter.password'
# pega la contraseña, pulsa Intro y después Ctrl+D
```

El agente rechaza un fichero que otros usuarios puedan leer.

@tab Windows

```powershell
Set-Content C:\ProgramData\InfraMole\vcenter.password '<contraseña>'
icacls C:\ProgramData\InfraMole\vcenter.password /inheritance:r /grant:r SYSTEM:F Administrators:F
```

:::

### Activa el colector

Añade una sección `collectors` al fichero de configuración del agente
(`/etc/inframole/agent.json` o `C:\ProgramData\InfraMole\agent.json`),
junto a las claves que ya tiene. Usa solo las que necesites:

```json
{
  "collectors": {
    "vcenter": {
      "url": "https://vcenter.corp.local",
      "username": "inframole@vsphere.local",
      "passwordFile": "/etc/inframole/vcenter.password",
      "caFile": "/etc/inframole/vcenter-ca.pem"
    },
    "xenOrchestra": {
      "url": "https://xo.corp.local",
      "tokenFile": "/etc/inframole/xo.token"
    },
    "hyperv": {}
  }
}
```

- `caFile`: la CA que firmó el certificado del servidor (en vCenter,
  descárgala de `https://vcenter/certs/download.zip`).
- `intervalSec` (opcional, en cada colector): cada cuánto se ejecuta — por
  defecto 3600, entre 300 y 86400.
- `"hyperv": {}` solo funciona en Windows.

### Prueba y reinicia el servicio

```sh
sudo inframole-agent dry-run --inventory --window 2s
```

La salida termina con una sección `hypervisors`: los hosts y VM que el
agente enviaría. Si cuadra, reinicia el servicio
(`sudo systemctl restart inframole-agent` o
`Restart-Service inframole-agent`).

:::

En InfraMole los hosts aparecen como servidores y las VM como máquinas
virtuales, ambos como **Discovered**, con una relación confirmada **hosts**
de cada host a sus VM. Las VM de Hyper-V cuelgan del equipo que ejecuta el
agente. Una VM que ejecuta su propio agente se reconoce como la misma
máquina — por su nombre o por el nombre de equipo del invitado — en vez de
aparecer dos veces. Las plantillas se omiten.

Cuando una VM desaparece del hipervisor pasa a **Stale** tras la siguiente
recogida correcta — no se borra nada.

:::note Laboratorios con certificados autofirmados
En un laboratorio sin una CA propia puedes añadir
`"insecureSkipVerify": true` al colector de vCenter o de Xen Orchestra. Solo
se puede poner localmente, y no deberías usarlo en producción.
:::

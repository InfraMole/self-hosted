# Inventario de Proxmox

Un agente instalado junto a un clúster de Proxmox VE también puede enviar
sus **nodos, máquinas virtuales y contenedores**, y en qué nodo está cada
uno. Usa un token de API de solo lectura que **nunca sale de la máquina**:
el servidor no puede activar esta función, cambiar su URL ni leer el token.

Qué se guarda: de cada nodo, máquina virtual y contenedor LXC, su id, tipo,
nodo, nombre, id de VM, estado, memoria y si es una plantilla. El agente
descarta el almacenamiento, los pools, los discos y todo lo demás que
devuelve la API.

:::steps

### Crea un token de API de solo lectura en Proxmox

En la interfaz web de Proxmox:

1. **Datacenter › Permissions › Users › Add**: usuario `inframole@pve`.
2. **Datacenter › Permissions › API Tokens › Add**: usuario
   `inframole@pve`, token id `inventory`, deja marcado **Privilege
   Separation**. Copia el secreto, que se muestra una sola vez.
3. **Datacenter › Permissions › Add › API Token Permission**: ruta `/`,
   token `inframole@pve!inventory`, rol **PVEAuditor** (solo lectura).

### Guarda el token en el equipo del agente

El fichero contiene una línea: `USER@REALM!TOKENID=SECRET`.

:::tabs
@tab Linux

```sh
echo 'inframole@pve!inventory=<secreto>' | sudo tee /etc/inframole/proxmox.token > /dev/null
sudo chmod 600 /etc/inframole/proxmox.token
# La CA del nodo, para que el agente pueda verificar el certificado:
sudo scp root@pve01:/etc/pve/pve-root-ca.pem /etc/inframole/pve-ca.pem
```

El agente rechaza un fichero de token que puedan leer otros usuarios.
@tab Windows

```powershell
Set-Content C:\ProgramData\InfraMole\proxmox.token 'inframole@pve!inventory=<secreto>'
icacls C:\ProgramData\InfraMole\proxmox.token /inheritance:r /grant:r SYSTEM:F Administrators:F
```

Copia `/etc/pve/pve-root-ca.pem` de un nodo de Proxmox a
`C:\ProgramData\InfraMole\pve-ca.pem`.
:::

### Activa el recolector

Edita el fichero de configuración del agente (`/etc/inframole/agent.json` o
`C:\ProgramData\InfraMole\agent.json`) y añade una sección `collectors`
junto a las claves existentes:

```json
{
  "collectors": {
    "proxmox": {
      "url": "https://pve01.lan:8006",
      "tokenFile": "/etc/inframole/proxmox.token",
      "caFile": "/etc/inframole/pve-ca.pem",
      "intervalSec": 3600
    }
  }
}
```

`intervalSec` es cada cuánto se recoge el inventario (3600 por defecto,
entre 300 y 86400).

### Prueba y reinicia el servicio

```sh
sudo inframole-agent dry-run --inventory --window 2s
```

La salida muestra el inventario que enviaría el agente. Si es correcto,
reinicia el servicio (`sudo systemctl restart inframole-agent` o
`Restart-Service inframole-agent`).

:::

En InfraMole los nodos, máquinas virtuales y contenedores aparecen como
**Discovered**, con relaciones _hosts_ confirmadas desde cada nodo a sus
invitados. Un invitado que ejecuta su propio agente se asocia a ese equipo
por nombre.

Cuando una máquina virtual desaparece de Proxmox pasa a **Stale** tras la
siguiente recogida correcta — no se borra nada.

:::note Laboratorios con certificados autofirmados
En un laboratorio sin una CA propia puedes añadir
`"insecureSkipVerify": true` al recolector. Solo se puede indicar
localmente, y no deberías usarlo en producción.
:::

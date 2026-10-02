# Importar ficheros

**Library › Import** convierte un fichero en recursos y relaciones. Pega el
contenido o sube el fichero; el formato se detecta automáticamente. Siempre
ves antes una **vista previa** — filas nuevas, actualizadas y sin cambios, y
los errores — y no se guarda nada hasta que pulsas **Import**.

Las importaciones son idempotentes: importar otra vez el mismo fichero
actualiza lo que cambió y no crea duplicados.

## Formatos admitidos

| Formato                           | Genera                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| **CSV**                           | Un CSV de recursos (un recurso por fila) o un CSV de relaciones                       |
| **JSON**                          | `{ "resources": [...], "relationships": [...] }`                                      |
| **docker-compose**                | Un contenedor por servicio (imagen, puertos); `depends_on` / `links` como sugerencias |
| Exportación de **Proxmox**        | Nodos, máquinas virtuales y contenedores LXC, con relaciones _hosts_                  |
| Exportación de **Azure**          | Máquinas virtuales (IP, tamaño, región, sistema operativo, etiquetas)                 |
| Exportación de **AWS**            | Instancias EC2 y bases de datos RDS                                                   |
| Exportación DNS de **Cloudflare** | Dominios a partir de registros A / AAAA / CNAME                                       |

## CSV

Las cabeceras no distinguen mayúsculas. Solo `name` es obligatoria.

```csv
name,type,environment,criticality,ips,hostname,os,tags
APP01,server,prod,high,10.0.0.23,app01.corp.local,Windows Server 2022,iis;web
SQL01,server,prod,critical,10.0.0.40,sql01.corp.local,Windows Server 2022,sql
CustomerAPI,app,prod,high,,,,api
```

Columnas admitidas: `name`, `type` (server, vm, app, db, saas, domain…),
`environment` / `env` (prod, stg, dev, qa…), `criticality`, `description`,
`notes`, `owner`, `owner_contact`, `tags` (separadas por `;`, `,`, `|` o espacios), `ips` /
`ip_addresses`, `hostname`, `fqdn`, `os`, `version` e `id` (una clave
estable; por defecto, el nombre).

Las relaciones van en **un CSV aparte** (impórtalo después de los recursos)
con `from`, `type`, `to` y `note`, donde `type` puede ser el nombre o una
etiqueta como `uses database`:

```csv
from,type,to
CustomerAPI,uses database,SQL01
CustomerAPI,runs on,APP01
```

Los extremos se buscan por `id` o nombre en el mismo fichero, y después por
un nombre único en la Library. Marca **Import CSV/JSON relationships as
suggestions to review** para revisarlas en Suggestions en lugar de
confirmarlas directamente.

## Exportaciones de plataformas

Ejecuta el comando de la propia plataforma donde ya tienes tus credenciales
y sube el JSON — InfraMole nunca ve tus credenciales:

:::tabs
@tab Proxmox

```sh
pvesh get /cluster/resources --output-format json > proxmox.json
```

@tab Azure

```sh
az vm list -d --output json > azure.json
```

@tab AWS

```sh
aws ec2 describe-instances --output json > ec2.json
aws rds describe-db-instances --output json > rds.json
```

:::

Para mantenerlos sincronizados automáticamente, usa en su lugar las
[integraciones en la nube](/es/docs/manual/integrations) o el
[inventario de Proxmox](/es/docs/agent/proxmox) del agente.

## Límites

1 MB por fichero, 2.000 recursos y 5.000 relaciones por importación. Los
límites del plan se aplican a servidores y máquinas virtuales: la vista
previa avisa antes de que una importación los supere.

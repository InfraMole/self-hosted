# Integraciones

Las integraciones mantienen InfraMole sincronizado con tus proveedores
usando credenciales de API de solo lectura. Las gestionan los admins y
owners del espacio de trabajo en **Settings › Integrations**.

- **Nubes**: Azure, AWS, Google Cloud, Hetzner Cloud, DigitalOcean,
  Scaleway, OVHcloud, Clouding, Vultr, Akamai Cloud (Linode), IONOS Cloud y
  Oracle Cloud — con sus balanceadores de carga, bases de datos gestionadas
  y, opcionalmente, registros DNS.
- **DNS y red**: Cloudflare y Tailscale.
- **Fuentes locales**: Proxmox VE, TrueNAS y Synology, que el servidor de
  InfraMole lee a través de sus API (ver [Fuentes locales](#fuentes-locales)).

:::note Cómo se protegen las credenciales
Las credenciales se cifran en reposo (AES-256-GCM) en cuanto las guardas y
no se vuelven a mostrar. InfraMole solo llama a API de lectura. Da a cada
integración los permisos **mínimos** que se indican abajo — nada más.
:::

:::steps

### Crea una credencial de solo lectura

**Nubes**

:::tabs
@tab Azure

1. En el portal de Azure: **Microsoft Entra ID › App registrations › New
   registration** (por ejemplo `inframole-reader`).
2. **Certificates & secrets › New client secret**. Copia el valor.
3. En la suscripción: **Access control (IAM) › Add role assignment ›
   Reader**, asignado a la aplicación.

Necesitarás el **tenant id**, el **subscription id**, el **client id** y el
**client secret**. Reader cubre también balanceadores, application
gateways, Azure SQL, servidores flexibles de PostgreSQL / MySQL y Azure DNS.
@tab AWS

1. En IAM, crea un usuario dedicado (sin acceso a la consola).
2. Adjúntale esta política en línea (las líneas `route53` solo si activas
   DNS):

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "ec2:DescribeInstances",
           "rds:DescribeDBInstances",
           "elasticloadbalancing:DescribeLoadBalancers",
           "elasticloadbalancing:DescribeListeners",
           "elasticloadbalancing:DescribeTargetGroups",
           "elasticloadbalancing:DescribeTargetHealth",
           "route53:ListHostedZones",
           "route53:ListResourceRecordSets"
         ],
         "Resource": "*"
       }
     ]
   }
   ```

3. Crea una clave de acceso para él.

Necesitarás la **región**, el **access key id** y el **secret access key**.
Una integración cubre una región. Las claves creadas con la política
anterior (solo EC2 y RDS) siguen funcionando: simplemente no se importan
los balanceadores.
@tab Google Cloud

1. **IAM & Admin › Service accounts › Create service account** (por
   ejemplo `inframole-reader`).
2. Concédele **Compute Viewer** y, si usas Cloud SQL, **Cloud SQL Viewer**
   sobre el proyecto.
3. **Keys › Add key › JSON**, y pega el fichero completo.

El fichero de la clave se cifra como cualquier otra credencial.
@tab Hetzner Cloud

1. En la Hetzner Console, abre el proyecto: **Security › API tokens ›
   Generate API token**.
2. Permiso: **Read** (nunca Read & Write).

Una integración cubre un proyecto, incluidas sus zonas DNS.
@tab DigitalOcean

1. **API › Tokens › Generate New Token** con **Custom scopes**.
2. Marca solo **droplet:read**, **load_balancer:read**,
   **database:read** y, para DNS, **domain:read** (todos menos el primero
   son opcionales).

Necesitarás el **token** (`dop_v1_…`).
@tab Scaleway

1. **IAM › Applications › Create application** (por ejemplo
   `inframole-reader`).
2. Asóciale una política con solo **InstancesReadOnly**,
   **LoadBalancersReadOnly** y **RelationalDatabasesReadOnly** sobre el
   proyecto.
3. **API keys › Generate an API key** para la aplicación; copia la
   **secret key**.

En la integración, indica las zonas que se leen (por ejemplo
`fr-par-1, nl-ams-1`).
@tab OVHcloud

1. Abre la página de tokens de tu región: Europa
   `https://eu.api.ovh.com/createToken/`, Canadá
   `https://ca.api.ovh.com/createToken/`, EE. UU.
   `https://api.us.ovhcloud.com/createToken/`.
2. Ponle un nombre (por ejemplo `inframole-reader`) y una validez, y añade
   exactamente estos derechos — uno por línea, método **GET** (los dos
   últimos solo para DNS):

   ```text
   GET /vps
   GET /vps/*
   GET /cloud/project
   GET /cloud/project/*
   GET /dedicated/server
   GET /dedicated/server/*
   GET /domain/zone
   GET /domain/zone/*
   ```

3. Crea las claves y copia los tres valores.

Necesitarás la **application key**, el **application secret** y la
**consumer key**. Los derechos no se pueden cambiar después: para añadir
uno, crea una clave nueva. Deja el proyecto vacío para leer todos los
proyectos de Public Cloud que la clave pueda ver.
@tab Clouding

1. En el portal de Clouding: **API › Crear API key**.

Las API keys de Clouding no se pueden limitar a lectura: crea una que solo
use InfraMole. InfraMole solo llama a `GET /v1/servers`.
@tab Vultr

1. Crea una subcuenta (**Account › Users**) que solo use InfraMole y
   actívale el acceso a la API.
2. En **Account › API › Access Control**, permite solo la IP pública de tu
   servidor de InfraMole.

Las claves de API de Vultr no se pueden limitar a lectura; InfraMole solo
hace `GET` (instancias, balanceadores, bases de datos).
@tab Akamai (Linode)

1. **Profile › API Tokens › Create a Personal Access Token**.
2. Pon **Linodes**, **NodeBalancers** y **Databases** en **Read Only** y
   todo lo demás en **No Access**.

@tab IONOS Cloud

1. En el Data Center Designer, crea un usuario que solo use InfraMole y
   añádelo a un grupo con acceso de lectura a tus centros de datos y sin
   privilegios de creación ni edición.
2. Crea un token para ese usuario (**Token Manager**, o `ionosctl token generate`).

Es IONOS **Cloud** (Compute Engine); los VPS de IONOS son otro producto sin
esta API.
@tab Oracle Cloud

1. Crea un usuario y un grupo (por ejemplo `inframole-readers`) con estas
   políticas:

   ```text
   Allow group inframole-readers to inspect compartments in tenancy
   Allow group inframole-readers to read instance-family in tenancy
   Allow group inframole-readers to read virtual-network-family in tenancy
   Allow group inframole-readers to read load-balancers in tenancy
   ```

2. **User › API keys › Add API key** y descarga la clave privada.

Necesitarás el **OCID del tenancy**, el **OCID del usuario**, la **huella**
de la clave, la **región** y la **clave privada** (PEM). Deja el
compartimento vacío para leer todos los del tenancy, o cambia `in tenancy`
por `in compartment <nombre>` e indica ese compartimento.
:::

**DNS y red**

:::tabs
@tab Cloudflare

1. **My Profile › API Tokens › Create Token › Custom token**.
2. Permisos: **Zone · Zone · Read** y **Zone · DNS · Read**.
3. Recursos de zona: las zonas que quieras (o todas).

Usa un **token** de API, nunca la clave global de API.
@tab Tailscale

1. **Settings › OAuth clients › Generate OAuth client**.
2. Ámbito: **devices:core** solo con **read**.

Necesitarás el **client ID** y el **client secret** (`tskey-client-…`).
También sirve un token de acceso a la API (`tskey-api-…`), dejando vacío el
client ID, pero caduca como mucho a los 90 días.
:::

**Fuentes locales** — lee antes [Fuentes locales](#fuentes-locales).

:::tabs
@tab Proxmox VE

1. **Datacenter › Permissions › Users › Add**: un usuario solo para
   InfraMole (por ejemplo `inframole@pve`).
2. **Datacenter › Permissions › Add › User Permission**: ruta `/`, rol
   **PVEAuditor**.
3. **Datacenter › Permissions › API Tokens › Add** para ese usuario, con
   **Privilege Separation** desactivado (o da al token el mismo rol).

Necesitarás el **ID del token** (`inframole@pve!sync`) y su **secreto**.
Las IP de las VM vienen del agente invitado de QEMU: instálalo en la VM.
@tab TrueNAS

1. **Credentials › Users › Add**: un usuario solo para InfraMole con el
   rol **Read-Only Administrator**.
2. **API Keys › Add** para ese usuario.

TrueNAS 25.04 o posterior (API JSON-RPC).
@tab Synology

1. **Panel de control › Usuario y grupo › Crear**: una cuenta solo para
   InfraMole, sin verificación en 2 pasos, con **Solo lectura** en las
   carpetas compartidas.

Las máquinas conectadas al NAS solo las ve una cuenta de administrador. No
la uses salvo que lo necesites.
:::

### Añade la integración

En **Settings › Integrations › Add integration**, elige el proveedor, dale
un nombre, elige cada cuánto se sincroniza (cada 6 horas por defecto, de 1
hora a 7 días) y pega los valores. Algunos proveedores tienen opciones:

- **DNS records** (Azure, AWS, Hetzner Cloud, DigitalOcean, OVHcloud) y
  **Records** (Cloudflare) — ver [Registros DNS](#registros-dns).
- **Devices not in the Library** (Tailscale) — ver [Tailscale](#tailscale).

:::note Integraciones en Preview
Todo salvo Cloudflare y las máquinas virtuales / bases de datos de Azure y
AWS está marcado como **Preview** — incluidos sus balanceadores, las bases
de datos gestionadas (Azure) y los registros DNS: están
hechas a partir de la documentación de la API de cada proveedor y probadas
con respuestas grabadas, pero todavía no con una cuenta real. Usa primero
**Test connection** — muestra qué se importaría sin guardar nada — y
avísanos si algo no cuadra.
:::

### Lanza la primera sincronización

Pulsa **Sync now**. El resultado indica qué se creó, qué se actualizó y qué
ya no aparece. A partir de ahí, la integración se sincroniza según su
calendario. En las instalaciones autoalojadas, las sincronizaciones
programadas necesitan `CRON_SECRET` (lo rellena `gen-secrets`).

:::

## Registros DNS

Cloudflare importa registros DNS; Azure, AWS (Route 53), Hetzner Cloud,
DigitalOcean y OVHcloud también pueden, con la misma credencial:

- **Don't import DNS records** — lo predeterminado en estos proveedores.
- **Only records pointing to servers in InfraMole** (recomendado) —
  registros A / AAAA cuya IP pertenece a un servidor, VM, balanceador o base
  de datos de la Library o de la misma sincronización, los CNAME hacia
  ellos, y los alias o CNAME hacia un balanceador o base de datos gestionada
  de la misma sincronización.
- **All**: todos los A / AAAA / CNAME.

Cada nombre pasa a ser un dominio que _depends on_ aquello a lo que apunta.
Los nombres con una etiqueta que empieza por `_` (DKIM, SRV…) nunca se
importan. Route 53 es global: activa DNS en una sola integración de AWS.

## Tailscale

Tailscale no duplica tus máquinas. Un dispositivo cuyo nombre coincide con
un servidor o VM que ya está en la Library (por nombre o nombre de host)
solo **añade** sus direcciones de la tailnet (`100.x.y.z`, `fd7a:…`) y una
etiqueta `tailscale` — nada más de ese recurso cambia, y nunca pasa a Stale
por culpa de Tailscale. Así, el tráfico que los agentes ven por Tailscale
se asigna a la máquina correcta.

Los dispositivos que no coinciden con nada se crean como servidores solo si
lo eliges: **los etiquetados** (lo predeterminado — en Tailscale, los
servidores suelen llevar etiquetas y los portátiles de las personas no),
**todos** o **ninguno**.

## Fuentes locales

Proxmox VE, TrueNAS y Synology los llama el propio **servidor de
InfraMole**, sin agente. Suelen estar en una red privada, a la que InfraMole
nunca llega salvo que el administrador de una instalación autoalojada lo
permita:

```sh
# .env de tu instalación — las redes a las que pueden llegar las fuentes locales
INTEGRATIONS_PRIVATE_NETWORKS=192.168.1.0/24,10.0.10.0/24
```

y después `docker compose up -d`. Solo lo usan estas integraciones; las de
nube nunca llegan a direcciones privadas. Esta máquina (`127.0.0.1`), las
direcciones link-local (metadatos de la nube) y multicast se rechazan
siempre. No se puede activar en InfraMole Cloud: allí, usa el
[agente](/es/docs/agent/hypervisors) para Proxmox.

**Certificados autofirmados.** Proxmox, TrueNAS y Synology suelen usar uno.
InfraMole nunca se salta la comprobación del certificado: pega en la
integración la **huella SHA-256** del certificado, y solo se acepta ese
certificado exacto. Para leerla desde una máquina de la misma red:

```sh
openssl s_client -connect pve.example.lan:8006 </dev/null 2>/dev/null \
  | openssl x509 -noout -fingerprint -sha256
```

(Proxmox también la muestra en **Node › System › Certificates**.) Cuando se
renueve el certificado, actualiza la huella. Déjala vacía si el certificado
es de una autoridad de confianza.

## Qué se importa

| Proveedor           | Recursos                                                                                                                                     | Relaciones                                                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Azure               | Máquinas virtuales (IP, tamaño, región, sistema, etiquetas); balanceadores y application gateways, Azure SQL, servidores flexibles (Preview) | VM e IP de un backend pool quedan _exposed through_ él                                                                                                    |
| AWS                 | Instancias EC2 (etiqueta Name, IP, plataforma); bases de datos RDS; balanceadores ALB / NLB (Preview)                                        | Los destinos registrados quedan _exposed through_ su balanceador                                                                                          |
| Google Cloud        | Instancias de Compute Engine (IP internas / externas, tipo, zona, etiquetas); instancias de Cloud SQL                                        | —                                                                                                                                                         |
| Hetzner Cloud       | Servidores (IPv4 pública e IP privadas, tipo, ubicación, imagen, etiquetas); balanceadores                                                   | Los destinos de un balanceador (también por selectores de etiquetas) quedan _exposed through_ él                                                          |
| DigitalOcean        | Droplets (IP, tamaño, región, etiquetas); balanceadores; bases de datos gestionadas                                                          | Los droplets de un balanceador quedan _exposed through_ él                                                                                                |
| Scaleway            | Instancias de las zonas indicadas; balanceadores; bases de datos gestionadas                                                                 | Las IP de backend de un balanceador quedan _exposed through_ él                                                                                           |
| OVHcloud            | VPS (nombre visible, IP, zona, modelo); instancias de Public Cloud; servidores dedicados (como servidores)                                   | —                                                                                                                                                         |
| Clouding            | Servidores (IP públicas / privadas, vCores, RAM, imagen, estado)                                                                             | —                                                                                                                                                         |
| Vultr               | Instancias (IP, plan, región, sistema, etiquetas); balanceadores; bases de datos gestionadas                                                 | Las instancias de un balanceador quedan _exposed through_ él                                                                                              |
| Akamai (Linode)     | Linodes (IP públicas y privadas, plan, región, imagen, etiquetas); NodeBalancers; bases de datos gestionadas                                 | Los nodos de backend de un NodeBalancer quedan _exposed through_ él                                                                                       |
| IONOS Cloud         | Servidores cloud de cada centro de datos (IP de las NIC, cores, RAM)                                                                         | —                                                                                                                                                         |
| Oracle Cloud        | Instancias de cómputo (IP de las VNIC, shape, etiquetas libres); balanceadores                                                               | Los backends de un balanceador quedan _exposed through_ él                                                                                                |
| DNS (las de arriba) | Registros A / AAAA / CNAME como dominios; en Cloudflare, un servicio externo `Cloudflare`                                                    | Un registro _depends on_ el recurso dueño de su IP; CNAME / alias → su destino; los registros de Cloudflare con proxy quedan _exposed through_ Cloudflare |
| Tailscale           | Direcciones de la tailnet añadidas a los servidores / VM que coinciden; los demás dispositivos según tu elección                             | —                                                                                                                                                         |
| Proxmox VE          | Nodos, VM y contenedores, con IP del nodo, de los contenedores y del agente invitado                                                         | Cada VM / contenedor _hosted by_ su nodo                                                                                                                  |
| TrueNAS             | El NAS; recursos SMB, exportaciones NFS y targets iSCSI                                                                                      | Cada recurso _runs on_ el NAS; las máquinas conectadas a un recurso cuando se lee se **sugieren** como _stores data in_ él                                |
| Synology            | El NAS y sus carpetas compartidas                                                                                                            | Cada carpeta _runs on_ el NAS; con una cuenta de administrador, las máquinas conectadas cuando se lee se **sugieren** como _stores data in_ el NAS        |

Los recursos importados empiezan como **Discovered**. Las etiquetas
llamadas `env` o `environment` fijan el entorno. Los backends de los
balanceadores y la ubicación se leen de la propia configuración del
proveedor, así que se importan como relaciones confirmadas. Una conexión
vista una vez en un NAS es solo una pista: revisa esas sugerencias en
**Suggestions**.

## Cuando algo desaparece

Si una sincronización posterior ya no lista algo que creó la integración,
ese recurso pasa a **Stale** — no se borra. Si vuelve, recupera su estado.
Como red de seguridad, si una sincronización fuera a marcar como Stale más
de la mitad de los recursos de una integración (por ejemplo, tras una
respuesta parcial de la API), no se marca nada y el mensaje de la
sincronización lo indica.

## Eliminar una integración

**Delete** pregunta si también quieres retirar lo que creó: los recursos sin
tocar se borran, y los que tienen notas, ediciones o relaciones confirmadas
se archivan. Los recursos que ya existían antes — incluidas las máquinas a
las que Tailscale solo añadió direcciones — nunca se tocan.

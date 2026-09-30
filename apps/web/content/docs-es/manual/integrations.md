# Integraciones en la nube

Las integraciones mantienen InfraMole sincronizado con **Azure**, **AWS**,
**Cloudflare**, **Hetzner Cloud**, **DigitalOcean**, **Scaleway**,
**OVHcloud**, **Google Cloud** y **Clouding** usando credenciales de API de
solo lectura. Las gestionan los
admins y owners del espacio de trabajo en **Settings › Integrations**.

:::note Cómo se protegen las credenciales
Las credenciales se cifran en reposo (AES-256-GCM) en cuanto las guardas y
no se vuelven a mostrar. InfraMole solo llama a API de lectura. Da a cada
integración los permisos **mínimos** que se indican abajo — nada más.
:::

:::steps

### Crea una credencial de solo lectura

:::tabs
@tab Azure

1. En el portal de Azure: **Microsoft Entra ID › App registrations › New
   registration** (por ejemplo `inframole-reader`).
2. **Certificates & secrets › New client secret**. Copia el valor.
3. En la suscripción: **Access control (IAM) › Add role assignment ›
   Reader**, asignado a la aplicación.

Necesitarás el **tenant id**, el **subscription id**, el **client id** y el
**client secret**.
@tab AWS

1. En IAM, crea un usuario dedicado (sin acceso a la consola).
2. Adjúntale esta política en línea:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": ["ec2:DescribeInstances", "rds:DescribeDBInstances"],
         "Resource": "*"
       }
     ]
   }
   ```

3. Crea una clave de acceso para él.

Necesitarás la **región**, el **access key id** y el **secret access key**.
Una integración cubre una región.
@tab Cloudflare

1. **My Profile › API Tokens › Create Token › Custom token**.
2. Permisos: **Zone · Zone · Read** y **Zone · DNS · Read**.
3. Recursos de zona: las zonas que quieras (o todas).

Usa un **token** de API, nunca la clave global de API.
@tab Hetzner Cloud

1. En la Cloud Console, abre el proyecto: **Security › API tokens ›
   Generate API token**.
2. Permiso: **Read** (nunca Read & Write).

Una integración cubre un proyecto.
@tab DigitalOcean

1. **API › Tokens › Generate New Token** con **Custom scopes**.
2. Marca solo **droplet:read**, **load_balancer:read** y
   **database:read** (los dos últimos son opcionales).
   @tab Scaleway

3. **IAM › Applications › Create application** (por ejemplo
   `inframole-reader`).
4. Asóciale una política con solo **InstancesReadOnly**,
   **LoadBalancersReadOnly** y **RelationalDatabasesReadOnly** sobre el
   proyecto.
5. **API keys › Generate an API key** para la aplicación; copia la
   **secret key**.

En la integración, indica las zonas que se leen (por ejemplo
`fr-par-1, nl-ams-1`).
@tab OVHcloud

1. Crea una clave de aplicación en la página de tokens de tu región (para
   Europa, `https://eu.api.ovh.com/createToken/`).
2. Derechos: **GET** sobre `/vps`, `/vps/*`, `/cloud/project`,
   `/cloud/project/*`, `/dedicated/server` y `/dedicated/server/*` — nada
   más. (Los derechos no se pueden cambiar después: para añadir uno, crea
   una clave nueva.)

Necesitarás la **application key**, el **application secret** y la
**consumer key**. Deja el proyecto vacío para leer todos los proyectos de
Public Cloud que la clave pueda ver.
@tab Google Cloud

1. **IAM & Admin › Service accounts › Create service account** (por
   ejemplo `inframole-reader`).
2. Concédele **Compute Viewer** y, si usas Cloud SQL, **Cloud SQL Viewer**
   sobre el proyecto.
3. **Keys › Add key › JSON**, y pega el fichero completo.
   @tab Clouding

4. En el portal de Clouding: **API › Crear API key**.

Las API keys de Clouding no se pueden limitar a lectura: crea una que solo
use InfraMole. InfraMole solo llama a `GET /v1/servers`.
:::

### Añade la integración

En **Settings › Integrations › Add integration**, elige el proveedor, dale
un nombre, elige cada cuánto se sincroniza (cada 6 horas por defecto, de 1
hora a 7 días) y pega los valores. Opcionalmente, en Cloudflare, indica las
zonas que se importan (vacío = todas) y qué registros: **solo los que
apuntan a servidores de InfraMole** (recomendado — registros A / AAAA cuya
IP pertenece a un servidor o VM de la Library, más los CNAME hacia ellos) o
**todos** los A / AAAA / CNAME. Los nombres con una etiqueta que empieza
por `_` (DKIM, SRV…) nunca se importan. Conecta primero tus servidores
(agente o integración en la nube) y después Cloudflare; un registro cuyo
servidor llega más tarde aparece en la siguiente sincronización.

:::note Integraciones en Preview
Hetzner Cloud, DigitalOcean, Scaleway, OVHcloud, Google Cloud y Clouding
están marcadas como **Preview**: están hechas a partir de la documentación
de la API de cada proveedor y probadas con respuestas grabadas, pero todavía
no con una cuenta real. Usa primero **Test connection** — muestra qué se
importaría sin guardar nada — y avísanos si algo no cuadra.
:::

### Lanza la primera sincronización

Pulsa **Sync now**. El resultado indica qué se creó, qué se actualizó y qué
ya no aparece. A partir de ahí, la integración se sincroniza según su
calendario. En las instalaciones autoalojadas, las sincronizaciones
programadas necesitan `CRON_SECRET` (lo rellena `gen-secrets`).

:::

## Qué se importa

| Proveedor     | Recursos                                                                                                         | Relaciones                                                                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Azure         | Máquinas virtuales con IP privadas / públicas, tamaño, región, sistema operativo y etiquetas                     | —                                                                                                                                                                           |
| AWS           | Instancias EC2 (etiqueta Name, IP, plataforma) y bases de datos RDS                                              | —                                                                                                                                                                           |
| Cloudflare    | Registros A / AAAA / CNAME como dominios; un servicio externo `Cloudflare`                                       | Los registros con proxy quedan _exposed through_ Cloudflare; un registro _depends on_ el recurso dueño de su IP de origen (solo si hay exactamente uno); CNAME → su destino |
| Hetzner Cloud | Servidores (IPv4 pública e IP privadas, tipo, ubicación, imagen, etiquetas); balanceadores de carga              | Los servidores configurados como destinos de un balanceador (también mediante selectores de etiquetas) quedan _exposed through_ él                                          |
| DigitalOcean  | Droplets (IP, tamaño, región, etiquetas); balanceadores de carga; bases de datos gestionadas                     | Los droplets de un balanceador quedan _exposed through_ él                                                                                                                  |
| Scaleway      | Instancias de las zonas indicadas; balanceadores de carga; bases de datos gestionadas                            | Las IP de backend de un balanceador quedan _exposed through_ él (solo si exactamente un recurso tiene esa IP)                                                               |
| OVHcloud      | VPS (nombre visible, IP, zona, modelo); instancias de Public Cloud; servidores dedicados (como servidores)       | —                                                                                                                                                                           |
| Google Cloud  | Instancias de Compute Engine (IP internas / externas, tipo de máquina, zona, etiquetas); instancias de Cloud SQL | —                                                                                                                                                                           |
| Clouding      | Servidores (IP públicas / privadas, vCores, RAM, imagen, estado de encendido)                                    | —                                                                                                                                                                           |

Los recursos importados empiezan como **Discovered**. Las etiquetas
llamadas `env` o `environment` fijan el entorno. El backend de un
balanceador se lee de la propia configuración del proveedor, así que se
importa como relación confirmada, no como sugerencia.

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
se archivan. Los recursos que ya existían antes nunca se tocan.

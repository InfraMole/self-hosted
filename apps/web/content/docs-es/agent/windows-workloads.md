# IIS y SQL Server

En servidores Windows el agente también puede informar de lo que se ejecuta
dentro: los **sitios de IIS** (activado por defecto) y las **bases de datos
de SQL Server** (desactivado hasta que lo actives). Aparecen en la Library
como aplicaciones y bases de datos que **se ejecutan en** (_run on_) el
servidor, para que el mapa y el impacto puedan nombrarlas — «Portal» y
«Customers» en lugar de solo «WEB01» y «SQL01».

Ambos necesitan el agente **0.2.0** o posterior y un servidor InfraMole
**0.5.0** o posterior. Un servidor anterior simplemente no los recibe.

## Qué se envía

| Carga de trabajo | Se envía                                                                                                                        | Nunca se lee                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Sitios de IIS    | Nombre del sitio; enlaces: protocolo (http/https), puerto, nombre de host; destinos de proxy de ARR / URL Rewrite (host:puerto) | Rutas físicas, identidades, contraseñas o claves guardadas |
| SQL Server       | Nombres de las bases de datos de cada instancia local (sin las de sistema)                                                      | Tablas, datos, inicios de sesión, tamaños ni nada más      |

El agente los recoge una vez por hora. Ejecuta `inframole-agent dry-run`
para ver exactamente qué se enviaría.

## Cómo aparecen

| En el servidor       | En InfraMole                                                                    |
| -------------------- | ------------------------------------------------------------------------------- |
| Sitio de IIS         | `Portal (WEB01)` — aplicación, etiqueta `iis`, se ejecuta en WEB01              |
| Base de datos        | `Customers (SQL01)` — base de datos, etiqueta `sql-server`, se ejecuta en SQL01 |
| Instancia con nombre | `Sales (SQL01\REPORTING)`                                                       |

Empiezan como **Discovered**. Un sitio o una base de datos que desaparece
pasa a **Stale** — no se borra nada. Puedes renombrarlos, añadir notas o
cambiar su criticidad como con cualquier otro recurso.

**Conexiones**: cuando una conexión llega a un puerto en el que escucha
exactamente un sitio de IIS de ese servidor (por ejemplo, un sitio con su
propio puerto 8443), la sugerencia apunta a ese sitio en lugar de al
servidor. Una conexión TCP no dice qué base de datos usa: para eso, activa
los [clientes de base de datos](#quien-usa-cada-base-de-datos).

## Qué sitio hace una conexión

IIS ejecuta el código de cada sitio en un proceso de trabajo (`w3wp.exe`)
del **grupo de aplicaciones** del sitio. Cuando un grupo sirve a un solo
sitio, el agente sabe a qué sitio pertenece cada proceso, y sus conexiones
— a SQL Server, a una API, a un servidor de ficheros — salen de ese sitio:
`Billing (WEB01) → SQL01` en lugar de `WEB01 → SQL01`.

El agente pregunta a IIS qué grupo ejecuta cada proceso (`appcmd list wp`,
solo lectura) y lee los grupos de cada sitio en `applicationHost.config`.
**Los nombres de los grupos no salen del servidor**: solo se envía el nombre
del sitio. Los procesos de un grupo compartido por varios sitios siguen
apuntando al servidor. Si ya tienes una relación entre los dos servidores,
se queda como está.

Activado por defecto con IIS; necesita el agente **0.8.0** y el servidor
**0.33.0**.

## Quién usa cada base de datos

Desactivado por defecto. En un servidor con SQL Server, el agente puede
listar qué equipos tienen **sesiones abiertas contra qué base de datos**, a
partir de la propia lista de sesiones de SQL Server. InfraMole sugiere
entonces `APP01 uses database Billing (SQL01)` — el cliente se identifica
por su dirección IP, como en una conexión.

| Se envía                                                                            | Nunca se lee                                                                                 |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Nombre de la base de datos, IP del cliente, puerto del servidor, número de sesiones | Inicios de sesión, nombres de equipo o de programa del cliente, consultas, datos ni nada más |

Se recoge con cada informe (cada 5 minutos por defecto). Las sesiones van y
vienen, así que un cliente que se desconecta conserva su sugerencia. Los
clientes del propio SQL Server se dejan fuera. Necesita el agente **0.8.0**
y el servidor **0.33.0**.

:::steps

### Permite al agente ver las otras sesiones

Sin este permiso SQL Server solo le muestra al agente su propia sesión.
Concédeselo al inicio de sesión del agente en cada instancia:

```sql
GRANT VIEW SERVER STATE TO [NT AUTHORITY\SYSTEM];
```

En SQL Server 2022 basta con `VIEW SERVER PERFORMANCE STATE`. Sin ninguno
de los dos, la página del equipo dice **«SQL Server database clients:
access denied»** en lugar de mostrar una lista vacía.

### Actívalo en la configuración del agente

```json
{
  "collectors": {
    "workloads": { "sqlServerClients": true }
  }
}
```

Esto activa también los nombres de las bases de datos (`sqlServer`): los
clientes se asocian a ellas. Compruébalo con `dry-run` (la sección
`databaseClients`) y reinicia el servicio como se explica abajo.

:::

## Reglas de proxy inverso (ARR)

Cuando IIS reenvía peticiones con **Application Request Routing** / URL
Rewrite (reglas de tipo _Rewrite_ hacia otro servidor, o una granja web), el
agente envía los destinos — solo host y puerto — desde
`applicationHost.config` y el `web.config` de cada sitio. Solo se decodifican
esas reglas: las cadenas de conexión y los ajustes de `web.config` nunca se
leen. InfraMole sugiere "el sitio depende de X" para los destinos que puede
emparejar (consulta
[Proxies inversos](/es/docs/agent/linux-workloads#proxies-inversos)).
Necesita el agente **0.6.0** y el servidor **0.13.0**.

## Activar SQL Server

:::steps

### Permite al agente leer los nombres de las bases de datos

El agente se conecta a cada instancia local con la identidad de su servicio
de Windows (**LocalSystem**, que SQL Server conoce como
`NT AUTHORITY\SYSTEM`) — no se guarda ninguna contraseña. Ese inicio de
sesión existe en muchas instalaciones; si no existe, créalo en SQL Server
Management Studio o con `sqlcmd`:

```sql
CREATE LOGIN [NT AUTHORITY\SYSTEM] FROM WINDOWS;
```

No hace falta ningún permiso adicional: por defecto, cualquier inicio de
sesión puede listar los nombres de las bases de datos (`VIEW ANY DATABASE`).

### Actívalo en la configuración del agente

Edita `C:\ProgramData\InfraMole\agent.json` como administrador y añade una
sección `collectors` junto a las claves existentes:

```json
{
  "collectors": {
    "workloads": { "sqlServer": true }
  }
}
```

### Comprueba y reinicia

```powershell
& "$env:ProgramFiles\InfraMole\inframole-agent.exe" dry-run --window 2s
Restart-Service inframole-agent
```

La sección `workloads` de la salida del dry-run muestra las bases de datos.

:::

:::warning Inicios de sesión fallidos
Si el agente no puede iniciar sesión en una instancia, SQL Server registra
un inicio de sesión fallido una vez por hora y el agente anota un aviso
(consulta [Gestionar y desinstalar](/es/docs/agent/manage#registros-logs)).
Por eso SQL Server está desactivado por defecto: actívalo donde exista ese
inicio de sesión.
:::

## Desactivar IIS

Para dejar de informar de los sitios de IIS en un servidor, añade a su
`agent.json`:

```json
{
  "collectors": {
    "workloads": { "iis": false }
  }
}
```

`"intervalSec"` en la misma sección cambia cada cuánto se recogen (3600 por
defecto, entre 300 y 86400).

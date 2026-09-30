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

| Carga de trabajo | Se envía                                                                  | Nunca se lee                                                                         |
| ---------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Sitios de IIS    | Nombre del sitio; enlaces: protocolo (http/https), puerto, nombre de host | Rutas físicas, grupos de aplicaciones, identidades, contraseñas o claves guardadas   |
| SQL Server       | Nombres de las bases de datos de cada instancia local (sin las de sistema) | Tablas, datos, inicios de sesión, tamaños ni nada más                               |

El agente los recoge una vez por hora. Ejecuta `inframole-agent dry-run`
para ver exactamente qué se enviaría.

## Cómo aparecen

| En el servidor     | En InfraMole                                                               |
| ------------------ | -------------------------------------------------------------------------- |
| Sitio de IIS       | `Portal (WEB01)` — aplicación, etiqueta `iis`, se ejecuta en WEB01          |
| Base de datos      | `Customers (SQL01)` — base de datos, etiqueta `sql-server`, se ejecuta en SQL01 |
| Instancia con nombre | `Sales (SQL01\REPORTING)`                                                |

Empiezan como **Discovered**. Un sitio o una base de datos que desaparece
pasa a **Stale** — no se borra nada. Puedes renombrarlos, añadir notas o
cambiar su criticidad como con cualquier otro recurso.

**Conexiones**: cuando una conexión llega a un puerto en el que escucha
exactamente un sitio de IIS de ese servidor (por ejemplo, un sitio con su
propio puerto 8443), la sugerencia apunta a ese sitio en lugar de al
servidor. Las conexiones a SQL Server siguen apuntando al servidor: una
conexión TCP no dice qué base de datos usa. Añade tú la relación _uses
database_ con la base de datos correcta.

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

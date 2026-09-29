# Tipos de relación

Una relación se lee **origen → tipo → destino**. La última columna indica si
un fallo de un lado podría afectar al otro — eso es lo que sigue la
[vista de impacto](/es/docs/manual/map-and-impact#impacto). Los nombres de
los tipos aparecen en inglés, como en la aplicación.

| Tipo               | Ejemplo                               | Visto desde el otro lado  | Un fallo podría propagarse              |
| ------------------ | ------------------------------------- | ------------------------- | --------------------------------------- |
| runs on            | `IIS` runs on `APP01`                 | hosts                     | del equipo a lo que se ejecuta en él    |
| hosts              | `PVE01` hosts `VM12`                  | runs on                   | del equipo a lo que aloja               |
| depends on         | `Portal` depends on `AuthAPI`         | required by               | de `AuthAPI` a `Portal`                 |
| connects to        | `APP01` connects to `SQL01`           | receives connections from | de `SQL01` a `APP01`                    |
| uses database      | `CustomerAPI` uses database `SQL01`   | database for              | de la base de datos a quienes la usan   |
| authenticates with | `Portal` authenticates with `AD`      | authenticates             | de `AD` a `Portal`                      |
| exposed through    | `Portal` exposed through `Cloudflare` | exposes                   | de `Cloudflare` a `Portal`              |
| stores data in     | `App` stores data in `S3 bucket`      | stores data for           | del almacenamiento a la aplicación      |
| calls              | `Web` calls `CustomerAPI`             | called by                 | de la API a quienes la llaman           |
| listens on         | `IIS` listens on `NET-DMZ`            | has listener              | de la red a quien escucha en ella       |
| backs up to        | `SQL01` backs up to `NAS01`           | backup target for         | informativa — no se usa para el impacto |
| monitored by       | `APP01` monitored by `Zabbix`         | monitors                  | informativa — no se usa para el impacto |
| related to         | —                                     | related to                | informativa — no se usa para el impacto |

Para un mismo par, usa mejor **runs on** que **hosts**, y nunca guardes
ambas. Las conexiones detectadas empiezan como **connects to**; al
confirmarlas puedes elegir un tipo más preciso (por ejemplo _uses database_
para el puerto 1433).

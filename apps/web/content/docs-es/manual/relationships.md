# Relaciones y sugerencias

Una relación dice cómo están conectados dos recursos, por ejemplo
`CustomerAPI` **uses database** `SQL01`. Las relaciones tienen dirección y
tipo (consulta [Tipos de relación](/es/docs/reference/relationship-types)).

## De dónde salen las relaciones

| Origen       | Quién la crea                                                  | Estado al crearse                                                                                        |
| ------------ | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Manual**   | Una persona                                                    | Confirmada                                                                                               |
| **Detected** | Un agente (conexión observada) o una importación / integración | Sugerencia sin confirmar — algunas importaciones las crean confirmadas (por ejemplo, _hosts_ de Proxmox) |
| **Inferred** | Una suposición razonable                                       | Sugerencia sin confirmar                                                                                 |

## Cuánta certeza hay

InfraMole siempre muestra cuánta certeza tiene, con la misma representación
en todas partes:

|                | Línea en el mapa    | Etiqueta          |
| -------------- | ------------------- | ----------------- |
| **Confirmada** | continua            | continua          |
| **Detectada**  | discontinua         | borde discontinuo |
| **Inferida**   | punteada, más tenue | borde punteado    |

Solo las relaciones **confirmadas** se presentan como dependencias. Las
detectadas y las inferidas se muestran como lo que son: sugerencias.

## Revisar sugerencias

**Suggestions** lista las relaciones detectadas pendientes de revisión, con
sus pruebas: puerto, protocolo probable (por ejemplo _MSSQL_ para el 1433),
el proceso que hizo la conexión y cuántas veces se vio.

Para cada una:

- **Confirm** — es real.
- **Confirm as "uses database"** (u otro tipo sugerido) — real, con un tipo
  más preciso.
- **Add context** — elige el tipo, añade una nota y confirma.
- **Ignore** — no es una dependencia (por ejemplo, tráfico de copias de
  seguridad o de monitorización). Los pares ignorados no se vuelven a
  sugerir.

Los miembros, admins y owners pueden revisar; los viewers pueden leer.

### Revisar muchas a la vez

Con agentes en muchos servidores, la lista crece rápido. Fíltrala por
**destino** (destination), **puerto** (port) o **proceso** (process), marca
**Select all** y después:

- **Confirm** — confirmarlas tal cual;
- **Confirm with suggested types** — cada una toma el tipo que sugiere su
  puerto (1433 → _uses database_, 389 → _authenticates with_…);
- **Ignore** — ignorarlas todas.

Se muestran hasta 1.000 sugerencias a la vez.

### Deshacer un «Ignorar»

Las sugerencias ignoradas se guardan en la pestaña **Ignored**. Selecciónalas
y elige **Restore** para devolverlas a la bandeja.

### Ignorar siempre cierto tráfico

Algunas conexiones nunca son dependencias: agentes de copias de seguridad,
actualizaciones del antivirus, monitorización. Filtra la bandeja por ese
puerto, proceso o destino y elige **Always ignore this traffic…**, o añade
una regla en la pestaña **Rules**. Una regla puede combinar un puerto, un
nombre de proceso y un recurso (cualquiera de los dos extremos de la
conexión); todos los campos que rellenes deben coincidir.

Al añadir una regla se eliminan las sugerencias que coinciden y que aún
esperan revisión, y los informes futuros de los agentes nunca convertirán
ese tráfico en sugerencias. Las relaciones confirmadas nunca se modifican.
Si borras la regla, ese tráfico puede volver a sugerirse al momento. Añadir
y quitar reglas queda anotado en el registro de auditoría.

### Sugerencias que desaparecen

Una sugerencia que ningún agente ha observado en **30 días** se elimina
automáticamente, y el historial de cambios (Changes) lo indica. Las
sugerencias creadas por una importación no caducan.

## Añadir una relación a mano

En la página de un recurso, abre **Dependencies › Add relationship**, elige
el otro recurso y el tipo. Las relaciones manuales quedan confirmadas.

## Por qué puede no aparecer una conexión

- Se vio menos de dos veces, o solo en una ventana corta (tareas nocturnas).
- La IP remota es desconocida, o pertenece a más de un recurso. Añade la IP
  al recurso correcto y la sugerencia aparecerá con el siguiente informe.
  Los destinos desconocidos se listan en el **Overview** del equipo, en
  _Observed on this host_.
- Pasa por NAT, un balanceador o un proxy, que ocultan el destino real.

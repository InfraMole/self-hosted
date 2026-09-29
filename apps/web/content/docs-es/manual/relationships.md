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

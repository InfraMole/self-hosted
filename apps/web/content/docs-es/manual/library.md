# Library

La Library es el inventario de un espacio de trabajo: cada servidor, máquina
virtual, aplicación, base de datos, dominio y servicio, tanto si lo añadiste
a mano como si lo importaste o lo descubrió un agente.

## Tipos de recurso

`Server`, `VM`, `Application`, `Windows service`, `Linux service`,
`Database`, `Domain`, `API`, `Storage`, `Network`, `Container`,
`External service` y `Other`.

Cada recurso puede tener un entorno (production, staging, development,
test), una criticidad (low → critical), etiquetas, direcciones IP, nombre de
equipo / FQDN, sistema operativo, versión, enlaces externos (solo https) y
notas de texto libre.

:::note Nunca secretos
Los recursos solo aceptan los campos anteriores: no hay dónde guardar
contraseñas ni claves, a propósito. Las notas son texto plano.
:::

## Estados

| Estado         | Significado                                                                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Active**     | Añadido o confirmado por una persona.                                                                                                                          |
| **Discovered** | Creado por un agente, una integración o una importación, y aún sin revisar.                                                                                    |
| **Stale**      | Su origen ha dejado de informar de él (un agente no envió tres informes, o una integración ya no lo lista). Vuelve a su estado anterior cuando se ve de nuevo. |
| **Archived**   | Se conserva por su historial, pero se oculta en la Library y en el mapa.                                                                                       |

Las personas pueden indicar **Active** o **Archived**; Discovered y Stale
solo los asigna el descubrimiento. Nunca se borra nada automáticamente.

## Buscar recursos

El cuadro de búsqueda encuentra nombres, descripciones, responsables,
nombres de equipo, etiquetas exactas y direcciones IP exactas. En cualquier
parte de un espacio de trabajo, **Ctrl K** (⌘K en Mac) abre una búsqueda
rápida de recursos y pantallas: Enter abre el recurso y Alt+Enter lo muestra
en el mapa. Los filtros acotan por tipo,
entorno, estado y **origen** — quién creó el recurso: una persona, un
agente, una integración o una importación de fichero.

## Añadir y editar

- **Add resource** abre un formulario; solo son obligatorios el nombre y el
  tipo.
- Pulsa en un recurso para abrir su página: **Overview** (detalles,
  conexiones observadas), **Dependencies** (relaciones en ambos sentidos) y
  **Activity** (cada cambio, con quién lo hizo).
- Los miembros (member), admins y owners pueden editar; los viewers solo
  pueden leer.

## Responsables

Asigna a un recurso un **responsable** (owner) — una persona o un equipo — y
un **contacto** (un correo, un teléfono, un canal de chat). El impacto de
cualquier recurso indica entonces **a quién avisar** (Who to warn): los
responsables de lo que podría verse afectado, con un mensaje que puedes
copiar en una petición de cambio. Asígnalos uno a uno con **Edit**, a muchos
recursos a la vez con **Set owner…** (abajo) o con las columnas `owner` /
`owner_contact` de una [importación](/es/docs/manual/imports).

## Acciones en bloque

Marca filas para **archivar**, **borrar** o **asignar el responsable** de
varios recursos a la vez (hasta 500). Al borrar también se eliminan sus relaciones; el diálogo de borrado
ofrece **Archive instead** (archivar en su lugar).

## Recursos de un origen eliminado

Cuando borras una integración o quieres deshacer una importación, filtra la
Library por ese origen y usa **Retire them…**: los recursos que nadie tocó
se borran, y los que tienen notas, ediciones o relaciones confirmadas se
archivan, para conservar su contexto. Los recursos que existían antes de ese
origen nunca se ven afectados.

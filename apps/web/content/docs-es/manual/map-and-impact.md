# Mapa e impacto

## El mapa

**Map** dibuja todos los recursos y relaciones del espacio de trabajo,
colocados automáticamente: los recursos que dependen de otros quedan
**encima** de lo que necesitan, y las flechas apuntan a lo que se necesita.

- **Filtros**: tipo de recurso, entorno, e interruptores para
  **Unconfirmed** (sugerencias detectadas e inferidas) y relaciones
  **Informational** (las que no propagan fallos, como _backs up to_ o
  _monitored by_).
- **Foco**: selecciona un recurso para ver solo su entorno, eligiendo la
  dirección (lo que necesita, lo que lo necesita o ambos) y la profundidad.
- **Inspector**: el panel lateral muestra el recurso o la relación
  seleccionados, con enlaces a su página.

**Cómo se ordena**: el mapa se lee como una pila, de arriba abajo —
puntos de entrada (CDN, dominios, balanceadores), aplicaciones, servicios,
bases de datos y almacenamiento, VMs y contenedores, y los servidores
abajo. Un recurso nunca está por encima de lo que depende de él, así que
las flechas apuntan hacia abajo, a lo que algo necesita; _exposed through_
es la excepción: sube hacia el proxy que tiene delante (el camino que sigue
una petición). Los grupos de recursos relacionados se dibujan uno al lado
de otro, y los recursos sin relaciones se reúnen en una pequeña cuadrícula.

**Servidores como cajas**: lo que se ejecuta en un único servidor, VM o
host — sitios, bases de datos, contenedores, VMs de un hipervisor — se
dibuja dentro de él, así que la ubicación no necesita flechas. Los mapas
con más de 25 recursos se abren con las cajas plegadas (un servidor muestra
**+N**, lo que contiene); pulsa **+N** para abrir una, o **Expand all** /
**Collapse all**. Las relaciones de lo que hay dentro de una caja plegada se
dibujan hacia la caja, y dicen qué representan al seleccionar cualquiera de
sus extremos (por ejemplo "Billing uses database CustomersDB"); una línea
que representa varias muestra **×2**. Las relaciones entre dos cosas de la
misma caja plegada no se dibujan: la caja las cuenta junto a **+N**, y al
seleccionarla se listan lo que contiene y esas relaciones. Un workload que se ejecuta en varios nodos se queda
fuera. El foco y el impacto siempre lo muestran todo.

En mapas grandes, algo a lo que apuntan muchos recursos (Active Directory,
monitorización) muestra cuántas líneas llegan a él en lugar de dibujarlas
todas: selecciónalo, o uno de los recursos que lo usan, para ver esas
líneas. Las líneas entre cajas plegadas se dibujan tenues hasta que
seleccionas uno de sus extremos.

**Find on map** (o la tecla `/`) busca por nombre, IP o responsable; al
elegir un recurso se selecciona y el mapa se centra en él, aunque lo ocultara
un filtro, un foco o una caja plegada.

**Los mapas grandes** se abren sobre su grupo principal a un tamaño
legible; usa el minimapa, el botón de encajar o el zoom para ver el resto.
Al alejar el zoom, los recursos muestran solo un icono y un nombre más
grandes, y más lejos solo su icono, para que la forma del mapa siga siendo
legible. Haz doble clic en un recurso para centrarte en él, o filtra por
tipo o entorno.

### Pregúntale a una línea por qué está ahí

Haz clic en una línea para ver qué dice — por ejemplo _Billing uses
database SQL01_ —, qué certeza tiene y **de dónde sale**: una conexión
observada (puertos, proceso, cuántas veces y cuándo se vio por última vez),
un host configurado para usar un servidor DNS, una importación o una
persona. Una sugerencia se puede confirmar o ignorar ahí mismo (miembros y
superiores). Una línea entre cajas plegadas representa varias relaciones:
elige una de la lista.

Una pequeña señal de aviso en un servidor indica que sus datos pueden estar
desactualizados: su agente dejó de informar o su último informe salió
incompleto. Pasa el ratón por encima, o selecciona el servidor, para ver
por qué.

### Mover cosas y guardar vistas

Arrastra un recurso para ponerlo donde lo esperas: se queda ahí (dentro de
su caja si está en una) hasta que pulses **Reset positions**. Las vistas de
foco e impacto siempre se colocan solas.

**Views** guarda lo que estás viendo —filtros, foco o impacto, cajas
abiertas y cerradas, y las posiciones que has fijado— con un nombre, para
todo el workspace. Elige una vista en el mismo menú o comparte el enlace
(termina en `?view=…`). Si cambias una vista, el menú indica _modified_ y
ofrece **Save changes**. Los miembros y superiores pueden guardar y borrar
vistas; los lectores pueden abrirlas.

**Enlaces públicos.** Los admins pueden compartir una vista guardada con
alguien sin cuenta — dirección, un cliente, un auditor: **Views**, el icono
de enlace junto a una vista, elige cuánto dura, **Create link**. Copia el
enlace en ese momento: no se vuelve a mostrar. Quien lo abra ve esa vista
tal como está ahora, solo lectura — nombres, tipos, entornos y cómo se
unen; **nunca direcciones IP, responsables, contactos, notas ni nada fuera
de la vista**. Los enlaces se listan y revocan en **Settings › Public map
links**; borrar la vista borra sus enlaces. Mientras una vista tenga un
enlace activo, solo los admins pueden cambiarla (los demás pueden guardar
sus cambios como una vista nueva). Si se borra el recurso en el que se basa
una vista de foco o de impacto, el enlace no muestra nada en lugar del mapa
entero.

El estilo de las líneas sigue la
[representación de la certeza](/es/docs/manual/relationships#cuanta-certeza-hay):
continua para confirmadas, discontinua para detectadas, punteada para
inferidas.

## Cómo están unidos dos recursos

Selecciona un recurso, elige **Path to…** en su panel y escoge otro. El mapa
muestra solo la cadena entre ambos, y el aviso dice qué significa:

- **A depends on B** — A depende de B, directamente o a través de otros
  recursos;
- **A may depend on B** — la cadena incluye relaciones que nadie ha
  confirmado todavía;
- **A and B are connected, but neither depends on the other** — están
  unidos, pero ninguno depende del otro (por ejemplo, usan la misma base de
  datos).

**Copy as text** te da la cadena paso a paso («Billing uses database
CustomersDB»), lista para una petición de cambio. Los scripts obtienen la
misma respuesta con la [API](/es/docs/reference/api).

## Impacto

Impact responde a **«¿qué podría verse afectado si esto desaparece?»**.
Ábrelo desde la página de un recurso (**Impact**) o desde el inspector del
mapa.

InfraMole sigue las relaciones en el sentido en que viajan los fallos: si
`Portal` depende de `AuthAPI`, un fallo de `AuthAPI` podría afectar a
`Portal`. Para cada recurso afectado muestra:

- **qué certeza** tiene el camino — un camino es tan cierto como su eslabón
  más débil, y se elige el camino más fuerte posible;
- **a cuántos saltos** está, y el propio camino.

El titular dice _«If SQL01 fails, N resources could be affected»_ (si SQL01
falla, N recursos podrían verse afectados), con recuentos por tipo y por
certeza. Usa **Max depth** para limitar hasta dónde mira. La página de
impacto tiene su propia dirección, así que puedes compartirla antes de una
ventana de mantenimiento.

:::warning Podría, no «va a»
El impacto describe lo que **podría** verse afectado según las relaciones
que tienes. Si faltan relaciones o no están confirmadas, el impacto real
puede ser mayor o menor. Confirma las sugerencias que importan para que sea
fiable.
:::

Los recursos archivados y las relaciones ignoradas quedan fuera del mapa y
del impacto.

### A quién avisar

Cuando los recursos tienen [responsable](/es/docs/manual/library#responsables),
la página de impacto muestra los responsables de lo que podría verse
afectado — agrupados y con su contacto — y **Copy message** te da un texto
para pegar en una petición de cambio o en un chat. También se listan los
recursos sin responsable, para que sepas qué falta.

### Redundancia

Dos réplicas de base de datos, un par de balanceadores, dos controladores de
dominio: cuando uno falla, lo que depende de ellos sigue funcionando.
Díselo a InfraMole dándoles el mismo **Redundancy group** (en **Edit**, o
con una columna `redundancy_group` en una
[importación](/es/docs/manual/imports)). Los nombres coinciden sin importar
mayúsculas; la página del recurso muestra los demás miembros.

El impacto se detiene entonces en un grupo mientras otro miembro sigue en
pie:

- lo que depende del grupo aparece en **Redundancy** como _covered by
  redundancy_ (cubierto por la redundancia) — lo siguen sirviendo los demás
  miembros — en lugar de _could be affected_;
- el propio grupo aparece como _loses redundancy_ (pierde redundancia), con
  los miembros caídos y los que siguen en pie;
- solo cuando **todos** los miembros caen — por ejemplo, al planificar un
  cambio de las dos réplicas a la vez — lo que depende de ellos cuenta como
  que podría verse afectado.

Lo que se ejecuta en un miembro (una base de datos en un servidor que falla)
siempre se ve afectado: la redundancia cubre a quienes consumen el grupo, no
lo que contiene.

En el mapa, la vista de impacto dibuja lo que cubre la redundancia con un
borde verde discontinuo y los miembros que siguen en pie con un borde
verde; cada miembro de un grupo muestra una pequeña etiqueta con el número
de miembros.

:::note Declarada, no verificada
Un grupo de redundancia es lo que tú dices de tu infraestructura. InfraMole
no comprueba que los miembros restantes aguanten la carga ni que el
failover funcione.
:::

## Planificar un cambio

Antes de una ventana de mantenimiento, una migración o un apagado, **Plan a
change** (en la barra lateral) responde la misma pregunta para varios
recursos a la vez: _«si SQL01 y APP02 dejan de funcionar el sábado, ¿qué
podría verse afectado y a quién avisamos?»_

:::steps

### Elige qué cambia

Selecciona recursos en la Library y elige **Plan a change**, usa **Plan a
change** en una página de impacto, o añádelos uno a uno con el buscador
(hasta 50). Ponle un título al cambio y, si quieres, cuándo será.

### Lee el impacto combinado

Cada recurso que podría verse afectado aparece una sola vez, con la
evidencia más fuerte que ofrece algún camino, a cuántos saltos está y —
cuando le llegan varios de los recursos que cambian — cuáles. Los recursos
que cambian caen a la vez, así que cambiar todos los miembros de un
[grupo de redundancia](#redundancia) juntos hace caer el grupo.

### Avisa a quien corresponde

**Who to warn** agrupa a los responsables de lo que cambia **y** de lo que
podría verse afectado, con su contacto.

### Comparte el informe

**Copy report** te da un resumen en texto para una petición de cambio, un
ticket o un correo. **Print / Save as PDF** imprime un informe limpio, en
claro (elige «Guardar como PDF» en el diálogo de impresión). **Show on
map** abre el mapa con todos los recursos que cambian y lo que podría verse
afectado.

:::

Un plan no se guarda: vive en su dirección, así que puedes añadirla a
favoritos o enviar el enlace a alguien del mismo espacio de trabajo. Si un
enlace antiguo incluye recursos archivados o borrados, se dejan fuera y la
página lo indica. El mismo cálculo está en la
[API de solo lectura](/es/docs/reference/api) (`/api/v1/impact`).

## Exportar un mapa o un impacto

**Export PNG**, **SVG** o **PDF** en la barra del mapa guarda exactamente lo
que ves: el mapa completo, los filtros actuales, un recurso en foco, una
vista de impacto o un cambio planificado. El fichero tiene fondo blanco para imprimirlo y compartirlo, con
un título (espacio de trabajo y vista), la fecha, la leyenda de los estilos
de línea y, en el impacto, qué recurso falla y qué podría verse afectado.
Una nota al pie recuerda que las relaciones detectadas e inferidas son
sugerencias.

| Formato | Ideal para                                                                                     |
| ------- | ---------------------------------------------------------------------------------------------- |
| PNG     | Chats, presentaciones y tickets — una imagen                                                   |
| SVG     | Documentación y diagramas — vectorial, nítido a cualquier zoom, editable en draw.io o Inkscape |
| PDF     | Imprimir y auditorías — vectorial, con texto que se puede seleccionar y buscar                 |

El fichero se dibuja en tu navegador: el mapa no se envía a ningún sitio
para crearlo. Los mapas muy grandes se exportan en PNG con menos resolución
para que el navegador pueda con ellos; SVG y PDF siguen nítidos. El PDF usa
fuentes estándar, que cubren los caracteres de Europa occidental; los
nombres en otros alfabetos aparecen ahí como «?» — para ellos, usa SVG.

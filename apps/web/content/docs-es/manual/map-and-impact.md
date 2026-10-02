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

## Exportar un mapa o un impacto

**Export PNG** o **PDF** en la barra del mapa guarda exactamente lo que ves:
el mapa completo, los filtros actuales, un recurso en foco o una vista de
impacto. El fichero tiene fondo blanco para imprimirlo y compartirlo, con
un título (espacio de trabajo y vista), la fecha, la leyenda de los estilos
de línea y, en el impacto, qué recurso falla y qué podría verse afectado.
Una nota al pie recuerda que las relaciones detectadas e inferidas son
sugerencias.

El fichero se dibuja en tu navegador: el mapa no se envía a ningún sitio
para crearlo. Los mapas muy grandes se exportan con menos resolución para
que el navegador pueda con ellos.

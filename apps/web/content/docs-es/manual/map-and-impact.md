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

**Mapas grandes**: con más de 300 recursos visibles, el mapa usa una
disposición más rápida y simplificada (los dependientes siguen encima de lo
que necesitan y las filas anchas se reparten en varias) y lo indica. Haz
doble clic en un recurso para centrarte en él, o filtra por tipo o entorno,
para ver la disposición detallada.

El estilo de las líneas sigue la
[representación de la certeza](/es/docs/manual/relationships#cuanta-certeza-hay):
continua para confirmadas, discontinua para detectadas, punteada para
inferidas.

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

# Inicio rápido

De cero a un primer mapa de dependencias en unos quince minutos.

:::steps

### Consigue un servidor InfraMole

Instala InfraMole en tu propio servidor: sigue
[Instalar en Linux](/es/docs/installation/linux) o
[Instalar en Windows](/es/docs/installation/windows), y después abre
`https://<tu dominio>/sign-up`. ¿Prefieres echar un vistazo primero? Prueba
la [demo en vivo](/es/demo).

### Crea tu espacio de trabajo

Tras registrarte, ponle nombre al espacio de trabajo (por ejemplo, tu
empresa o un cliente). Serás su **propietario** (owner). Puedes invitar a
tus compañeros más adelante desde **Settings › Members**.

### Añade tus primeros servidores

La Library vacía muestra tres formas de empezar. Usa cualquiera:

- **Instala el agente** en uno o dos servidores que se comuniquen entre sí
  (por ejemplo, un servidor web y su base de datos). Consulta
  [Instalar el agente](/es/docs/agent/install).
- **Conecta una nube** en **Settings › Integrations** (Azure, AWS,
  Cloudflare, Hetzner, DigitalOcean…) con un token de solo lectura. Consulta
  [Integraciones en la nube](/es/docs/manual/integrations).
- **Importa un fichero**: un CSV con tus servidores, un fichero
  docker-compose o una exportación de Proxmox. Consulta
  [Importar ficheros](/es/docs/manual/imports).

### Revisa las sugerencias

Pasados unos minutos, los agentes envían las conexiones que observan. Abre
**Suggestions** y, para cada relación detectada, elige **Confirm**
(confirmar), **Add context** (cambiar el tipo, añadir una nota) o
**Ignore** (ignorar).

### Explora el mapa y el impacto

Abre **Map** para ver todo conectado. Selecciona un recurso y pulsa
**Impact** para ver qué podría verse afectado si desapareciera — con la
certeza de cada camino.

:::

:::tip Empieza por poco
Dos o tres servidores que conozcas bien son el mejor comienzo: podrás
contrastar cada sugerencia con lo que ya sabes y ver cómo presenta InfraMole
la certeza.
:::

# Cómo funciona el agente

`inframole-agent` es un único binario para **Windows** y **Linux** (x86-64 y
ARM64). Observa el equipo en el que se ejecuta y envía un pequeño informe a
tu servidor InfraMole cada cinco minutos. Es estrictamente de **solo
lectura**.

## Qué envía

| Dato                                                                                                                       | Para qué                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Nombre del equipo, FQDN, sistema operativo, kernel, arquitectura, hora de arranque                                         | Identificar el equipo                                                                        |
| Interfaces de red (nombre, MAC, direcciones IP)                                                                            | Relacionar las conexiones de otros equipos                                                   |
| Servicios en ejecución (nombre, estado, tipo de inicio)                                                                    | Mostrar qué se ejecuta en el equipo                                                          |
| Puertos TCP en escucha + nombre / ruta del proceso propietario                                                             | Saber qué ofrece el equipo                                                                   |
| Conexiones TCP establecidas, **agregadas** por destino, puerto y proceso                                                   | Sugerir dependencias                                                                         |
| Windows: nombres y enlaces de los sitios de IIS; nombres de las bases de datos de SQL Server si se activa                  | Mostrar qué se ejecuta en el servidor ([IIS y SQL Server](/es/docs/agent/windows-workloads)) |
| Linux: nombres y puertos de los sitios de nginx / Apache; nombres de las bases de datos de PostgreSQL / MySQL si se activa | Lo mismo ([nginx, Apache y bases de datos](/es/docs/agent/linux-workloads))                  |

Las conexiones se muestrean cada 30 segundos y se resumen; se ignora el
tráfico loopback, link-local y multicast. La lista completa, con un informe
de ejemplo real, está en [Qué recoge el agente](/es/agent).

## Qué no recoge nunca

Contraseñas, credenciales, tokens, contenido de ficheros, documentos de
usuario, datos del navegador, **argumentos de línea de comandos**, variables
de entorno, usuarios con sesión iniciada ni contenido de los paquetes. Las
estructuras de datos del agente no tienen campos para ellos, y el servidor
rechaza cualquier informe con campos inesperados.

## Cómo se comunica con el servidor

- Solo **HTTPS saliente**, hacia tu dirección de InfraMole. Nada se conecta
  al agente; no se abre ningún puerto de entrada.
- **Sin canal de órdenes**: el servidor solo puede responder con los
  intervalos de envío. Nunca puede pedirle al agente que ejecute nada.
- Cada agente tiene su propia credencial, creada al registrarse a partir de
  un **token de registro** (caduca, y puede limitarse a un número de
  agentes). Revocar el agente en InfraMole rechaza sus informes al instante.

## Permisos

El agente se ejecuta como servicio (**LocalSystem** en Windows, **root** con
systemd en Linux) porque el sistema operativo lo exige para ver qué proceso
es dueño de cada socket. No escribe nada fuera de su directorio de
configuración. Sin permisos de administrador sigue funcionando, con menos
nombres de proceso.

## De los informes a las sugerencias

1. El primer informe crea el equipo en la Library como **Discovered**
   (descubierto).
2. Las conexiones vistas al menos dos veces hacia una IP que pertenece a
   exactamente otro recurso se convierten en una relación **detectada** en
   Suggestions (por ejemplo `APP01 → SQL01:1433 (likely MSSQL)`).
3. Una persona la confirma, le añade contexto o la ignora. Los pares
   ignorados no se vuelven a sugerir.
4. Si un equipo deja de informar durante tres intervalos pasa a **Stale**
   (desactualizado); vuelve a su estado anterior cuando informa de nuevo.

:::note Límites de la observación
El muestreo puede perder conexiones poco frecuentes o muy cortas (por
ejemplo, una tarea nocturna). El NAT, los balanceadores y los proxies
ocultan el destino real. Y una conexión no demuestra una dependencia — por
eso la confirma una persona.
:::

## Verificar los binarios

Las versiones publican `SHA256SUMS`, firmado con Sigstore, y una atestación
de procedencia (build provenance) para cada binario. Los comandos de
instalación de InfraMole comprueban la suma antes de ejecutar nada. Consulta
[Instalar el agente](/es/docs/agent/install).

# Qué es InfraMole

InfraMole es un **mapa de dependencias de infraestructura** ligero para
equipos de IT pequeños, MSP, startups y homelabs. Responde a cuatro preguntas:

- **¿Qué tengo?** Cada servidor, máquina virtual, aplicación, base de datos,
  dominio y servicio, en un único inventario (Library).
- **¿Cómo está conectado?** Las relaciones entre ellos — con tipo, con
  dirección y siempre indicando cuánta certeza tenemos.
- **¿Qué depende de esto?** Un mapa generado a partir de los datos, nunca
  dibujado a mano.
- **¿Qué podría verse afectado si esto desaparece?** La vista de impacto
  sigue las dependencias desde cualquier recurso y muestra lo que _podría_
  verse afectado.

## Cómo funciona

InfraMole sigue tres pasos: **Instalar → Descubrir → Entender**.

1. **Instalar** un pequeño agente de solo lectura en tus servidores (Windows
   o Linux), conectar una cuenta en la nube (Azure, AWS, Cloudflare) o
   importar un fichero.
2. **Descubrir**: se observan los equipos, los servicios y las conexiones de
   red entre ellos, y se convierten en **sugerencias**.
3. **Entender**: tu equipo confirma lo que importa y añade el contexto que
   solo conocen las personas. El mapa y la vista de impacto hacen el resto.

:::note Las sugerencias no son hechos
Una conexión observada en la red no demuestra una dependencia. InfraMole
muestra las relaciones detectadas e inferidas como sugerencias hasta que
alguien las confirma, y los resultados de impacto siempre indican la certeza
de cada camino.
:::

## Qué no es InfraMole

- **No es monitorización.** Ni alertas, ni métricas, ni paneles que vigilar.
- **No es una CMDB.** Ni formularios que rellenar antes de sacarle partido.
- **Nunca control remoto.** La plataforma no puede ejecutar nada en tus
  máquinas; el agente no tiene canal de órdenes.

## Arquitectura

| Componente                     | Qué hace                                                                                                                            |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Servidor InfraMole**         | La aplicación web y la API, una base de datos PostgreSQL y Caddy para HTTPS. Funciona en Docker.                                    |
| **Agente** (`inframole-agent`) | Un binario por servidor. Cada 5 minutos envía por HTTPS datos del equipo, servicios, puertos en escucha y conexiones TCP agregadas. |
| **Integraciones**              | Tokens de API de solo lectura para Azure, AWS y Cloudflare, cifrados en reposo y sincronizados periódicamente.                      |
| **Importadores**               | CSV, JSON, docker-compose y exportaciones de Proxmox, Azure, AWS y Cloudflare.                                                      |

## Autoalojado hoy, Cloud más adelante

InfraMole **Community** es gratis y de código abierto (AGPL-3.0): lo instalas
en tu propio servidor, con servidores y máquinas virtuales ilimitados y un
espacio de trabajo. Están previstos **InfraMole Cloud** (lo gestionamos
nosotros) y una edición **Business** para equipos más grandes. Consulta
[Ediciones y límites](/es/docs/reference/editions).

:::note Sobre el idioma
La documentación está en español, pero la aplicación está en inglés. Los
nombres de pantallas y botones (**Library**, **Map**, **Settings ›
Members**…) aparecen tal como los verás en ella.
:::

## Siguientes pasos

- [Inicio rápido](/es/docs/quickstart): de cero a un primer mapa.
- [Instalar en Linux](/es/docs/installation/linux) o
  [en Windows](/es/docs/installation/windows) para alojarlo tú mismo.
- [Cómo funciona el agente](/es/docs/agent/overview) y qué recoge.

# Seguridad y rendimiento

Una sola página para los equipos de IT y de seguridad que evalúan InfraMole:
qué recoge el agente, cómo habla con el servidor, cuánto les cuesta a tus
servidores, dónde están los datos y cómo inicia sesión la gente. Todo lo que
aparece aquí se aplica a la edición Community, gratuita.

:::cards
@card Solo lectura
Sin canal de órdenes: el servidor nunca puede ejecutar nada en tus máquinas.
@card 0 puertos
El agente no abre ningún puerto de escucha. Solo conecta hacia fuera, por HTTPS.
@card ~15 MB
Memoria del agente, medida en Linux.
@card ~0,2 %
De un núcleo de CPU, con 1.500 conexiones abiertas.
@card ~19 KB
Por informe, cada 5 minutos, con 50 destinos.
@card On-premises
Autoalojado en tu propio servidor. No llama a casa.
:::

## Qué recoge el agente

El agente describe el equipo en el que se ejecuta y las conexiones TCP que
ve. Nada más.

| Se recoge                                                                              | Para qué                                          |
| -------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Nombre del equipo, sistema operativo, arquitectura, interfaces de red y direcciones IP | Identificar el equipo y relacionar sus conexiones |
| Servicios en ejecución y puertos en escucha, con el nombre del proceso                 | Mostrar qué ofrece el equipo                      |
| Conexiones TCP, **agregadas** por IP remota, puerto y nombre del proceso local         | Sugerir dependencias                              |

Los recolectores opcionales leen **solo nombres**: sitios y enlaces de IIS,
bases de datos de SQL Server (desactivado por defecto), contenedores de
Docker, destinos de proxies inversos (nginx, Apache, HAProxy, Traefik) e
inventarios de Kubernetes y de hipervisores.

:::tip Nunca se recoge
Contraseñas, credenciales, tokens, contenido de ficheros, contenido de bases
de datos, contenido de paquetes, argumentos de línea de comandos, variables
de entorno ni usuarios conectados. El formato del informe no tiene campos
para ellos, y el servidor rechaza cualquier informe con campos inesperados.
:::

Para ver exactamente qué enviaría una máquina, sin enviar nada:

```sh
inframole-agent dry-run
```

La lista completa, con un informe real de ejemplo, está en
[Qué recoge el agente](/es/agent). El agente es de código abierto:
[github.com/InfraMole/agent](https://github.com/InfraMole/agent).

## Cómo habla el agente con el servidor

:::steps

### Un administrador crea un token de alta

En Settings › Agents. El token caduca, puede limitarse a un número de
agentes y solo se muestra una vez.

### El agente lo cambia por su propia credencial

Una sola vez, al instalarlo. Cada agente recibe un secreto aleatorio de 256
bits; el servidor solo guarda su hash SHA-256.

### Los informes salen por HTTPS

Cada 5 minutos, iniciados por el agente, con TLS 1.2 o superior. El agente
rechaza HTTP sin cifrar y las redirecciones. Cada informe ocupa como máximo
1 MB y se valida contra un esquema estricto.

### Cualquier agente se puede revocar

Al revocarlo en Settings › Agents, su siguiente informe se rechaza al
momento.

:::

- **Sin canal de órdenes.** El servidor solo puede responder con los
  intervalos de envío; nunca puede pedirle al agente que ejecute nada.
- **Por qué se ejecuta como servicio** (LocalSystem en Windows, root en
  Linux): el sistema operativo solo muestra a un administrador qué proceso
  usa cada conexión. El agente no escribe nada fuera de su directorio de
  configuración y, sin esos permisos, sigue funcionando con menos nombres de
  proceso.
- **Versiones firmadas.** Cada binario se publica con `SHA256SUMS`, firma de
  Sigstore y una atestación de procedencia de la compilación; los comandos de
  instalación comprueban el checksum antes de ejecutar nada.
- **Actualizaciones opcionales.** Las actualizaciones automáticas están
  desactivadas por defecto; si se activan, el agente solo instala versiones
  cuyo manifiesto lleva la firma de InfraMole.

## Consumo en tus servidores

| Recurso | Medido                                                             | Cómo se comporta                                                                                  |
| ------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Memoria | Unos 14–15 MB residentes                                           | Estable en el tiempo                                                                              |
| CPU     | 30–60 ms por muestra con 1.500 conexiones (0,1–0,2 % de un núcleo) | Las conexiones se muestrean cada 30 segundos; el coste crece con el número de conexiones abiertas |
| Red     | Unos 19 KB por informe con 50 destinos (5–6 MB al día)             | Depende de con cuántos servicios habla un servidor, no del volumen de tráfico; máximo 1 MB        |
| Disco   | Unos pocos KB: su configuración (y el estado de actualización)     | Sin base de datos local; los informes no se encolan en disco                                      |

Los recolectores de inventario (IIS, Docker, hipervisores…) se ejecutan una
vez por hora por defecto; su frecuencia se puede ajustar entre 5 minutos y
un día en `agent.json`.

:::note Cómo lo medimos
Agente 0.6.1 en Linux (x86-64), con 1.500 conexiones establecidas hacia 50
servicios de otra máquina. Son cifras de laboratorio, no de una base de datos
en producción. En un servidor con decenas de miles de conexiones simultáneas,
cada muestra cuesta proporcionalmente más.
:::

### Servidores de aplicaciones y bases de datos con carga

- Sin captura de paquetes, módulos del kernel, drivers ni eBPF. El agente lee
  las mismas tablas de conexiones y procesos que `netstat` o `ss`.
- Las conexiones se resumen antes de enviarse, así que un servidor con mucho
  tráfico no envía informes más grandes que uno tranquilo con los mismos
  interlocutores.
- Los recolectores opcionales se ejecutan como mucho cada 5 minutos, y por
  defecto cada hora.

## Dónde están los datos

- **En tu servidor.** InfraMole funciona con Docker Compose (x86-64 o ARM64)
  y PostgreSQL. Los agentes solo hablan con tu servidor y el software no
  llama a casa. La comprobación de versiones (`UPDATE_CHECK`, activada en
  las instalaciones nuevas) solo pregunta a las versiones públicas de GitHub
  por los últimos números de versión; no se envía nada de tu instalación.
  Para desactivarla, pon `false`.
- **Los espacios de trabajo se aíslan dos veces**: en la aplicación y, de
  nuevo, con seguridad a nivel de fila en la base de datos.
- **Las credenciales guardadas van cifradas.** Los tokens de las
  integraciones y los secretos del inicio de sesión único (secretos de
  cliente de OpenID Connect, claves de firma SAML, cuentas de servicio de
  LDAP) se cifran con AES-256-GCM, con la clave fuera de la base de datos. Las integraciones solo necesitan
  acceso de lectura.
- **Retención corta de los datos en bruto.** Las observaciones en bruto de
  los agentes se borran a los 7 días; lo que queda es el mapa: recursos,
  relaciones y su historial.
- **Copias de seguridad cifradas**, con copia opcional fuera del servidor en
  almacenamiento compatible con S3
  ([Copias de seguridad](/es/docs/operations/backups)).
- **Tus datos son tuyos.** Exporta un espacio de trabajo en JSON o bórralo
  cuando quieras.

## Inicio de sesión y acceso

- **Inicio de sesión único** con tu proveedor de identidad: OpenID Connect
  (Entra ID, Okta, Keycloak…), SAML 2.0 (ADFS, Shibboleth…) o LDAP / Active
  Directory. Los grupos del directorio deciden el rol de cada persona en cada
  inicio de sesión ([Inicio de sesión único](/es/docs/manual/single-sign-on)).
- **Autenticación en dos pasos** (TOTP) y **llaves de acceso** para todas las
  cuentas; un espacio de trabajo puede exigir 2FA.
- **Cuatro roles** por espacio de trabajo: Viewer, Member, Admin y Owner
  ([Miembros y seguridad](/es/docs/manual/members-and-security)).
- **Registro de auditoría** de miembros, integraciones, agentes y ajustes, de
  solo escritura y conservado un año.
- **API de solo lectura** con tokens que pueden caducar y revocarse
  ([API de solo lectura](/es/docs/reference/api)).
- El inicio de sesión con contraseña tiene límite de intentos, y los mensajes
  de error nunca revelan si una cuenta existe.

## La aplicación web

- HTTPS con certificados automáticos, HSTS y una Content Security Policy
  estricta; las páginas no se pueden incrustar en otros sitios.
- El servidor y el agente son de código abierto (AGPL-3.0): tu equipo puede
  revisar el código en [github.com/InfraMole](https://github.com/InfraMole).

:::note Informar de una vulnerabilidad
Escribe a [security@inframole.com](mailto:security@inframole.com). Por favor,
no abras una incidencia pública para problemas de seguridad.
:::

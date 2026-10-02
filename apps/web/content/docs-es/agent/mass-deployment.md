# Desplegar en muchas máquinas

Instalar el agente a mano está bien para unos pocos servidores. Para decenas
o cientos, usa las plantillas del
[repositorio del agente](https://github.com/InfraMole/agent/tree/main/deploy):

| Plantilla                            | Para                                                  |
| ------------------------------------ | ----------------------------------------------------- |
| `windows/Install-InfraMoleAgent.ps1` | Directiva de grupo (GPO), Intune, una herramienta RMM |
| `linux/install-inframole-agent.sh`   | cloud-init, una herramienta RMM, un bucle por ssh     |
| `ansible/inframole-agent.yml`        | Ansible (equipos Linux)                               |

Todas se pueden ejecutar una y otra vez sin problema:

- una máquina ya inscrita **nunca se inscribe dos veces**;
- si el servicio está parado se arranca; si se eliminó, se reinstala con la
  credencial que la máquina ya tiene;
- el binario se comprueba contra `SHA256SUMS` antes de ejecutarlo;
- el token de inscripción va en una variable de entorno, nunca en una línea
  de comandos que otros usuarios puedan leer.

## Antes de empezar: el token

Crea un token de inscripción para el despliegue en **Settings › Agents ›
New enrollment token**:

- **Expires in**: lo bastante largo para el despliegue (7 o 30 días).
- **Max agents**: el número de máquinas, con algo de margen.
- **Revócalo** al terminar. Los agentes ya inscritos siguen funcionando:
  cada uno tiene su propia credencial.

Un token puesto en una GPO, un script de Intune o un playbook lo pueden leer
otros (cualquier usuario del dominio puede leer los scripts de una GPO).
Quien lo copie solo puede inscribir más agentes en tu espacio de trabajo
hasta que caduque o lo revoques: no puede leer nada, y lo que un agente
envía solo aparece como _Discovered_.

## Windows — Directiva de grupo

:::steps

### Deja el script donde los equipos puedan leerlo

Copia `Install-InfraMoleAgent.ps1` en la carpeta de la propia directiva (el
botón **Mostrar archivos…** del paso siguiente la abre) o en
`\\<tu-dominio>\NETLOGON`.

### Añádelo como script de inicio

En **Administración de directivas de grupo**, crea una GPO y edítala:
**Configuración del equipo › Directivas › Configuración de Windows ›
Scripts (inicio o apagado) › Inicio › Scripts de PowerShell › Agregar**.
Elige el script y pon los parámetros:

```text
-Server https://inframole.example.com -EnrollmentToken dmp_enr_...
```

### Espera a la red al arrancar

Activa **Configuración del equipo › Directivas › Plantillas
administrativas › Sistema › Inicio de sesión › Esperar siempre a la red
al iniciar el equipo y al iniciar sesión**, para que el script llegue al
servidor.

### Vincula la GPO

Vincúlala a la unidad organizativa de los servidores. Instalarán el agente
en el siguiente reinicio (o tras `gpupdate /force` y un reinicio).

:::

El script se ejecuta como SYSTEM en cada arranque y no hace nada una vez
instalado el agente. Deja un registro breve en
`C:\ProgramData\InfraMole\deploy.log`.

## Windows — Intune

Los scripts de plataforma de Intune no admiten parámetros, así que rellénalos
en el script:

:::steps

### Rellena los dos valores

Abre una copia de `Install-InfraMoleAgent.ps1` y pon, cerca del principio:

```powershell
$IntuneServer = "https://inframole.example.com"
$IntuneEnrollmentToken = "dmp_enr_..."
```

### Añade un script de plataforma

En el centro de administración de Intune: **Dispositivos › Scripts y
correcciones › Scripts de plataforma › Agregar › Windows 10 y versiones
posteriores**. Sube el script y elige:

- **Ejecutar este script con las credenciales del usuario que inició
  sesión**: No (se ejecuta como SYSTEM)
- **Exigir la comprobación de la firma del script**: No (o fírmalo tú)
- **Ejecutar script en un host de PowerShell de 64 bits**: **Sí** — si no,
  el agente acaba en `Program Files (x86)`

### Asígnalo

Asígnalo a un grupo de dispositivos. Intune lo ejecuta una vez por
dispositivo, y otra vez si cambias el script.

:::

## Linux — Ansible

El playbook instala el agente, inscribe cada equipo una sola vez y mantiene
el servicio en marcha. Guarda el token en un vault:

```sh
ansible-vault create vault.yml      # inframole_enrollment_token: dmp_enr_...
ansible-playbook -i inventory.ini inframole-agent.yml \
  -e inframole_server=https://inframole.example.com \
  -e @vault.yml --ask-vault-pass
```

Ejecútalo cuando quieras: los equipos ya inscritos no se tocan (el token
solo hace falta para los nuevos). Variables:

| Variable                      | Por defecto            | Significado                             |
| ----------------------------- | ---------------------- | --------------------------------------- |
| `inframole_server`            | —                      | Tu dirección de InfraMole (`https://…`) |
| `inframole_enrollment_token`  | —                      | Solo para equipos aún no inscritos      |
| `inframole_agent_version`     | `latest`               | O una versión concreta, como `v0.6.0`   |
| `inframole_download_base_url` | la publicación pública | Un espejo interno (ver abajo)           |
| `inframole_hosts`             | `all`                  | Qué grupo del inventario                |

Cambiar `inframole_agent_version` sustituye el binario y reinicia el agente
en todos los equipos; así también se vuelve atrás. Si Ansible gestiona las
versiones, deja desactivada la actualización automática del agente (viene
desactivada).

## Linux — un script (cloud-init, RMM)

`install-inframole-agent.sh` hace lo mismo que el playbook, configurado con
variables de entorno. En cloud-init, por ejemplo:

```yaml
runcmd:
  - curl -fsSL -o /tmp/install.sh https://raw.githubusercontent.com/InfraMole/agent/main/deploy/linux/install-inframole-agent.sh
  - INFRAMOLE_SERVER=https://inframole.example.com INFRAMOLE_ENROLLMENT_TOKEN=dmp_enr_... sh /tmp/install.sh
```

## Máquinas sin acceso a internet

Deja los ficheros del agente de una versión en un servidor web interno o en
una carpeta compartida: los cuatro binarios `inframole-agent_*` y
`SHA256SUMS` (comprueba su firma una vez al llenar el espejo — ver las
[publicaciones del agente](https://github.com/InfraMole/agent#releases-and-verification)).
Después indícalo a las plantillas:

| Plantilla  | Ajuste                                                                |
| ---------- | --------------------------------------------------------------------- |
| PowerShell | `-DownloadBaseUrl \\fileserver\software\inframole-agent`              |
| Shell      | `INFRAMOLE_DOWNLOAD_BASE_URL=https://mirror.example.com/inframole`    |
| Ansible    | `-e inframole_download_base_url=https://mirror.example.com/inframole` |

## Comprueba el despliegue

Las máquinas nuevas aparecen en **Settings › Agents** en unos minutos, y en
la Library como _Discovered_. En una máquina, `inframole-agent status`
indica si está inscrita y si el servicio funciona.

Para quitar el agente de muchas máquinas, ejecuta `inframole-agent
uninstall` con la misma herramienta y revoca los agentes en **Settings ›
Agents** (ver [Gestionar y desinstalar](/es/docs/agent/manage)).

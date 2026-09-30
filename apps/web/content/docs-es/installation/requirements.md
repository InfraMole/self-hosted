# Requisitos

InfraMole autoalojado funciona como un pequeño conjunto de contenedores
Docker: la aplicación web, PostgreSQL, Caddy (HTTPS), un planificador y una
copia de seguridad nocturna.

## Plataformas compatibles

| Plataforma                                                                           | Uso                                                              | Guía                                                                |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Linux** (Ubuntu 22.04+, Debian 12+, RHEL / Rocky / AlmaLinux 9+) con Docker Engine | **Recomendado para producción**                                  | [Instalar en Linux](/es/docs/installation/linux)                    |
| **Windows 10 / 11** con Docker Desktop (WSL 2)                                       | Evaluación y equipos pequeños                                    | [Instalar en Windows](/es/docs/installation/windows)                |
| **Windows Server**                                                                   | Usa una máquina virtual Linux (Hyper-V) y sigue la guía de Linux | [Instalar en Windows](/es/docs/installation/windows#windows-server) |
| **macOS** con Docker Desktop u OrbStack                                              | Evaluación                                                       | [Instalar en macOS](/es/docs/installation/macos)                    |

Se admiten x86-64 y ARM64 (por ejemplo, una Raspberry Pi 4/5 con 4 GB o
más).

## Hardware

| Tamaño                | CPU      | RAM  | Disco |
| --------------------- | -------- | ---- | ----- |
| Hasta ~100 servidores | 1–2 vCPU | 2 GB | 10 GB |
| Hasta ~500 servidores | 2–4 vCPU | 4 GB | 20 GB |

Deja espacio para las copias de seguridad (`./backups`, 14 días por
defecto). Los informes de los agentes son pequeños (unos 10 KB) y los
informes en bruto solo se guardan 7 días.

## Red

- Un **nombre DNS** para el servidor (por ejemplo `inframole.example.com`)
  con un registro `A` / `AAAA` que apunte a él.
- Los puertos **80 y 443** accesibles desde internet, para que Caddy obtenga
  un certificado gratuito de Let's Encrypt. Solo se publican esos dos
  puertos.
- Los **agentes** necesitan HTTPS saliente (443) hacia ese nombre. Nada se
  conecta a los agentes.
- Opcional: SMTP saliente (465 o 587) para los correos, y HTTPS saliente
  hacia las API de los proveedores que conectes con integraciones.

:::note Instancias solo internas
Let's Encrypt tiene que llegar a los puertos 80/443 para emitir el
certificado. Si el servidor debe quedarse en la red interna, usa la
autoridad de certificación interna de Caddy (consulta
[Prueba local](/es/docs/installation/configuration#prueba-local-sin-nombre-publico)):
los navegadores avisarán hasta que confíes en esa autoridad en tus equipos.
:::

## Software

- Docker Engine **24+** con el plugin **Compose v2** (`docker compose`), o
  Docker Desktop 4.x.
- `curl` (o PowerShell en Windows) para descargar la versión.
- Opcional: una cuenta SMTP para los correos de verificación, de
  restablecimiento de contraseña y de invitación.

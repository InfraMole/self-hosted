# Instalar en Linux

Esta guía instala InfraMole Community en un servidor Linux con Docker. Lleva
unos diez minutos. Revisa antes los [requisitos](/es/docs/installation/requirements):
un nombre DNS que apunte al servidor y los puertos 80/443 abiertos.

:::steps

### Instala Docker

Sáltate este paso si `docker compose version` ya funciona.

:::tabs
@tab Ubuntu / Debian

```sh
sudo apt-get update
sudo apt-get install -y ca-certificates curl
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo systemctl enable --now docker
docker compose version
```

@tab RHEL / Rocky / AlmaLinux

```sh
sudo dnf -y install dnf-plugins-core
sudo dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
sudo dnf -y install docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo systemctl enable --now docker
docker compose version
```

:::

`get-docker.sh` es el instalador oficial de Docker; léelo antes si tu
política lo exige. Para usar `docker` sin `sudo`, añade tu usuario al grupo
`docker` y vuelve a iniciar sesión: `sudo usermod -aG docker $USER`.

### Abre el cortafuegos

Solo los puertos 80 y 443 tienen que ser accesibles.

:::tabs
@tab ufw (Ubuntu / Debian)

```sh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw status
```

@tab firewalld (RHEL family)

```sh
sudo firewall-cmd --permanent --add-service=http --add-service=https
sudo firewall-cmd --reload
```

:::

Permítelos también en el grupo de seguridad de tu proveedor cloud, si lo
hay.

### Descarga InfraMole

```sh
sudo mkdir -p /opt/inframole && sudo chown $USER /opt/inframole && cd /opt/inframole
curl -fsSLO https://github.com/InfraMole/self-hosted/releases/latest/download/inframole-self-hosted.tar.gz
curl -fsSLO https://github.com/InfraMole/self-hosted/releases/latest/download/inframole-self-hosted.tar.gz.sha256
sha256sum -c inframole-self-hosted.tar.gz.sha256
tar xzf inframole-self-hosted.tar.gz --strip-components=1
```

`sha256sum` debe mostrar `OK`. La carpeta contiene ahora
`docker-compose.yml`, `Caddyfile`, `.env.example` y `scripts/`.

### Configura

```sh
cp .env.example .env
./scripts/gen-secrets.sh .env
nano .env
```

`gen-secrets.sh` rellena todas las contraseñas y claves vacías. En el editor
indica al menos `DEPMAP_DOMAIN` (tu nombre DNS, sin `https://`). Se
recomienda configurar el correo (`SMTP_URL`, `MAIL_FROM`) y las copias
cifradas (`BACKUP_AGE_RECIPIENT`) — consulta
[Configuración](/es/docs/installation/configuration).

:::warning Guarda una copia de .env
Guarda `.env` en tu gestor de contraseñas. Sin `CREDENTIALS_ENCRYPTION_KEY`
no se pueden descifrar las credenciales guardadas de las integraciones, y
restaurar una copia de seguridad es más difícil sin las contraseñas de la
base de datos.
:::

### Arranca

```sh
docker compose up -d
docker compose ps
```

El primer arranque descarga las imágenes, aplica las migraciones de la base
de datos y solicita el certificado. En más o menos un minuto todos los
servicios deberían estar `running` (web: `healthy`).

### Comprueba que funciona

```sh
curl https://inframole.example.com/api/health
```

La respuesta es `{"status":"ok"}`. Si no, consulta
[Solución de problemas](/es/docs/operations/troubleshooting).

### Crea tu cuenta

Abre `https://<tu dominio>/sign-up`, crea la primera cuenta y el espacio de
trabajo. Serás su **propietario** (owner); invita a tu equipo desde
**Settings › Members**.

:::

:::note Registro abierto
Cualquiera que llegue a la dirección puede crear una cuenta. Community
permite un espacio de trabajo por instalación, así que no pueden crear el
suyo ni ver el tuyo — pero puedes limitar el registro a invitaciones con
`SIGNUP=closed` (consulta
[Configuración](/es/docs/installation/configuration#registro-solo-por-invitacion)).
:::

## Siguientes pasos

- [Instala el agente](/es/docs/agent/install) en tus servidores.
- Configura [copias de seguridad fuera del servidor](/es/docs/operations/backups).

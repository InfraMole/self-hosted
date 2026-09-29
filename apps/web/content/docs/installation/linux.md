# Install on Linux

This guide installs InfraMole Community on a Linux server with Docker. It
takes about ten minutes. Check the [requirements](/docs/installation/requirements)
first: a DNS name pointing at the server and ports 80/443 open.

:::steps

### Install Docker

Skip this step if `docker compose version` already works.

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

`get-docker.sh` is Docker's official installer; read it first if your policy
requires. To run `docker` without `sudo`, add your user to the `docker` group
and log in again: `sudo usermod -aG docker $USER`.

### Open the firewall

Only ports 80 and 443 need to be reachable.

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

Also allow them in your cloud provider's security group if there is one.

### Download InfraMole

```sh
sudo mkdir -p /opt/inframole && sudo chown $USER /opt/inframole && cd /opt/inframole
curl -fsSLO https://github.com/InfraMole/self-hosted/releases/latest/download/inframole-self-hosted.tar.gz
curl -fsSLO https://github.com/InfraMole/self-hosted/releases/latest/download/inframole-self-hosted.tar.gz.sha256
sha256sum -c inframole-self-hosted.tar.gz.sha256
tar xzf inframole-self-hosted.tar.gz --strip-components=1
```

`sha256sum` must print `OK`. The folder now contains `docker-compose.yml`,
`Caddyfile`, `.env.example` and `scripts/`.

### Configure

```sh
cp .env.example .env
./scripts/gen-secrets.sh .env
nano .env
```

`gen-secrets.sh` fills every empty password and key. In the editor set at
least `DEPMAP_DOMAIN` (your DNS name, without `https://`). Setting up email
(`SMTP_URL`, `MAIL_FROM`) and encrypted backups (`BACKUP_AGE_RECIPIENT`) is
recommended — see [Configuration](/docs/installation/configuration).

:::warning Keep a copy of .env
Store `.env` in your password manager. Without `CREDENTIALS_ENCRYPTION_KEY`
stored integration credentials cannot be decrypted, and restoring a backup
is harder without the database passwords.
:::

### Start

```sh
docker compose up -d
docker compose ps
```

The first start downloads the images, applies the database migrations and
requests the certificate. After about a minute every service should be
`running` (web: `healthy`).

### Check it works

```sh
curl https://inframole.example.com/api/health
```

The answer is `{"status":"ok"}`. If not, see
[Troubleshooting](/docs/operations/troubleshooting).

### Create your account

Open `https://<your domain>/sign-up`, create the first account and the
workspace. You are its **owner**; invite your team from **Settings ›
Members**.

:::

:::note Open sign-up
Anyone who can reach the address can create an account. Community allows one
workspace per installation, so they cannot create their own or see yours —
but for an internal tool, keeping the server behind your VPN or firewall is
simpler.
:::

## Next steps

- [Install the agent](/docs/agent/install) on your servers.
- Set up [backups off the server](/docs/operations/backups).

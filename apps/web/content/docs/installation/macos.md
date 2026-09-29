# Install on macOS

macOS is great for trying InfraMole on your laptop. For a shared server, use
[Linux](/docs/installation/linux).

:::steps

### Install Docker

Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) or
[OrbStack](https://orbstack.dev) and start it. Check in Terminal:

```sh
docker compose version
```

### Download InfraMole

```sh
mkdir -p ~/inframole && cd ~/inframole
curl -fsSLO https://github.com/InfraMole/self-hosted/releases/latest/download/inframole-self-hosted.tar.gz
curl -fsSLO https://github.com/InfraMole/self-hosted/releases/latest/download/inframole-self-hosted.tar.gz.sha256
shasum -a 256 -c inframole-self-hosted.tar.gz.sha256
tar xzf inframole-self-hosted.tar.gz --strip-components=1
```

### Configure for a local trial

```sh
cp .env.example .env
./scripts/gen-secrets.sh .env
```

Then edit `.env` and set:

```sh
DEPMAP_DOMAIN=localhost
CADDY_TLS=tls internal
```

Caddy then uses its own certificate authority instead of Let's Encrypt.

### Start

```sh
docker compose up -d
```

Open [https://localhost/sign-up](https://localhost/sign-up). Your browser
warns once about the certificate; accept it for this trial.

:::

:::tip Agents on your laptop
With `tls internal` the agent does not trust Caddy's local certificate
authority, so agent tests are easier against a server with a real
certificate (a small Linux VM or InfraMole Cloud).
:::

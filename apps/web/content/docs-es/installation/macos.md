# Instalar en macOS

macOS es perfecto para probar InfraMole en tu portátil. Para un servidor
compartido, usa [Linux](/es/docs/installation/linux).

:::steps

### Instala Docker

Instala [Docker Desktop](https://www.docker.com/products/docker-desktop/) u
[OrbStack](https://orbstack.dev) y arráncalo. Compruébalo en Terminal:

```sh
docker compose version
```

### Descarga InfraMole

```sh
mkdir -p ~/inframole && cd ~/inframole
curl -fsSLO https://github.com/InfraMole/self-hosted/releases/latest/download/inframole-self-hosted.tar.gz
curl -fsSLO https://github.com/InfraMole/self-hosted/releases/latest/download/inframole-self-hosted.tar.gz.sha256
shasum -a 256 -c inframole-self-hosted.tar.gz.sha256
tar xzf inframole-self-hosted.tar.gz --strip-components=1
```

### Configura para una prueba local

```sh
cp .env.example .env
./scripts/gen-secrets.sh .env
```

Después edita `.env` e indica:

```sh
DEPMAP_DOMAIN=localhost
CADDY_TLS=tls internal
```

Así Caddy usa su propia autoridad de certificación en lugar de Let's
Encrypt.

### Arranca

```sh
docker compose up -d
```

Abre [https://localhost/sign-up](https://localhost/sign-up). El navegador
avisará una vez del certificado; acéptalo para esta prueba.

:::

:::tip Agentes en tu portátil
Con `tls internal` el agente no confía en la autoridad de certificación local
de Caddy, así que es más fácil probar agentes contra un servidor con un
certificado real (por ejemplo, una pequeña máquina virtual Linux).
:::

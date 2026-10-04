# Copias de seguridad y restauración

## Qué se copia

El servicio `backup` vuelca cada noche la base de datos completa en
`./backups` (junto a `docker-compose.yml`) como `depmap-<fecha>.dump`, y
borra los volcados con más de `BACKUP_KEEP_DAYS` días (14 por defecto). La
base de datos lo contiene todo: cuentas, espacios de trabajo, recursos,
relaciones, historial y las credenciales cifradas de las integraciones.

Dos cosas **no** están en el volcado y hay que guardarlas aparte:

- **`.env`** — las contraseñas y claves. Sin `CREDENTIALS_ENCRYPTION_KEY`
  no se pueden descifrar las credenciales de las integraciones de una
  copia, y sin `BETTER_AUTH_SECRET` la autenticación en dos pasos deja de
  funcionar.
- La **clave privada** de age, si cifras las copias.

## Cifrar las copias

:::steps

### Crea un par de claves en otra máquina

Instala [age](https://age-encryption.org) en tu equipo de trabajo (no en el
servidor) y ejecuta:

```sh
age-keygen -o inframole-backup-key.txt
```

Muestra la clave pública (`age1…`). Guarda `inframole-backup-key.txt` en tu
gestor de contraseñas o sin conexión.

### Configura el servidor

En `.env`:

```sh
BACKUP_AGE_RECIPIENT=age1...
```

Después `docker compose up -d`. A partir de la noche siguiente, los
volcados se escriben como `depmap-<fecha>.dump.age`, cifrados antes de tocar
el disco.

:::

## Sacar las copias del servidor

Una copia en el mismo disco no sobrevive a la pérdida del servidor. El
servicio de copias puede subir cada volcado **cifrado** a un almacenamiento
de objetos compatible con S3 (AWS S3, Backblaze B2, Wasabi, Scaleway,
OVHcloud, Cloudflare R2, tu propio MinIO o Garage…) y borrar allí también las
copias más antiguas que `BACKUP_KEEP_DAYS`. Crea un bucket y una clave que
solo pueda leer y escribir en ese bucket, y añade a `.env`:

```sh
BACKUP_S3_ENDPOINT=https://s3.eu-central-003.backblazeb2.com
BACKUP_S3_REGION=eu-central-003       # si tu proveedor la pide
BACKUP_S3_BUCKET=inframole-backups
BACKUP_S3_PREFIX=prod                 # carpeta, opcional
BACKUP_S3_ACCESS_KEY_ID=…
BACKUP_S3_SECRET_ACCESS_KEY=…
```

y `docker compose up -d`. El registro del servicio `backup` indica
`uploaded … to …` tras cada volcado. **La subida necesita
`BACKUP_AGE_RECIPIENT`**: InfraMole nunca saca del servidor un volcado sin
cifrar.

Para restaurar desde el bucket, descarga el `.dump.age` que necesites en
`./backups` (con la consola de tu proveedor o `rclone copy`) y sigue
[Restaurar](#restaurar).

También puedes copiar `./backups` por tu cuenta — `rsync` a otra máquina,
`restic` o tu NAS.

## Hacer una copia ahora

```sh
docker compose exec backup sh -c 'pg_dump -h db -U depmap -d depmap -Fc > /backups/manual-$(date -u +%Y%m%dT%H%M%SZ).dump'
```

Hazlo antes de actualizar.

## Restaurar

:::warning Restaurar sustituye los datos
Una restauración sustituye toda la base de datos por el contenido del
volcado. Detente a pensar qué volcado necesitas; todo lo posterior se
pierde.
:::

:::steps

### Deja el volcado en ./backups

Copia el fichero en la carpeta `backups`, junto a `docker-compose.yml`.

### Lanza la restauración

:::tabs
@tab Linux / macOS

```sh
./scripts/restore.sh depmap-20261001T020000Z.dump
# cifrado:
./scripts/restore.sh depmap-20261001T020000Z.dump.age /ruta/segura/inframole-backup-key.txt
```

@tab Windows (WSL o Git Bash)

```sh
cd /mnt/c/InfraMole          # Git Bash: cd /c/InfraMole
./scripts/restore.sh depmap-20261001T020000Z.dump
```

:::

El script detiene la aplicación, restaura el volcado y vuelve a arrancarla.
La clave privada se copia en el contenedor de copias solo mientras dura la
restauración.

### Comprueba

Abre InfraMole y verifica los datos. Si has restaurado en un servidor nuevo,
usa el mismo `.env` que el antiguo.

:::

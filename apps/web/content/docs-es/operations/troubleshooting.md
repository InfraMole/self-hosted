# Solución de problemas

Empieza por el estado de los servicios y sus registros:

```sh
docker compose ps
docker compose logs --tail 100 web
docker compose logs --tail 100 caddy
```

## El sitio no carga

| Comprobación                  | Cómo                                                                                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Todos los servicios en marcha | `docker compose ps` — `web` debería estar `healthy`. Si `migrate` terminó con error, mira sus registros: `docker compose logs migrate`.                         |
| El DNS apunta aquí            | `nslookup inframole.example.com` devuelve la dirección pública de este servidor.                                                                                |
| Puertos accesibles            | Desde fuera: `curl -I http://inframole.example.com` responde con una redirección a https. Revisa el cortafuegos y el router / grupo de seguridad del proveedor. |
| Nada más en 80/443            | Linux: `sudo ss -ltnp 'sport = :443'`. Windows: consulta [Libera los puertos 80 y 443](/es/docs/installation/windows#libera-los-puertos-80-y-443).              |

## Errores de certificado

Caddy registra cada intento de certificado: `docker compose logs caddy |
grep -i certificate`. Las causas habituales son un registro DNS que aún no
apunta al servidor, el puerto 80 bloqueado (lo necesita la verificación de
Let's Encrypt) o demasiados intentos fallidos — Let's Encrypt espera
entonces antes de volver a intentarlo.

## No llegan los correos

- `docker compose logs web | grep '\[mail\]'` muestra los errores de envío
  (nunca el contenido de los mensajes).
- Revisa `SMTP_URL` (`smtps://` para el puerto 465, `smtp://` para el 587) y
  que el proveedor permita la dirección de `MAIL_FROM`.
- Sin correo, los enlaces de invitación se muestran en pantalla después de
  invitar.

## Un agente no aparece

En el equipo:

:::tabs
@tab Windows

```powershell
& "$env:ProgramFiles\InfraMole\inframole-agent.exe" status
Get-WinEvent -FilterHashtable @{ LogName = "Application"; ProviderName = "inframole-agent" } -MaxEvents 10
```

@tab Linux

```sh
sudo inframole-agent status
journalctl -u inframole-agent -n 30 --no-pager
```

:::

| Mensaje                      | Significado                                                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Error de certificado / x509  | El agente no confía en el certificado del servidor (por ejemplo, con `tls internal`). Usa un certificado real.                     |
| `401` / unauthorized         | El agente fue revocado, o el token de registro caducó antes de registrarse. Crea un token nuevo e instala de nuevo.                |
| `402` / límite del plan      | Se ha alcanzado el límite de servidores/máquinas virtuales del plan.                                                               |
| timeout / connection refused | El equipo no llega al servidor por el 443: cortafuegos o proxy (consulta [proxies](/es/docs/agent/install#cortafuegos-y-proxies)). |

## No aparecen sugerencias

Las conexiones solo se convierten en sugerencias cuando la IP remota
pertenece a exactamente un recurso de la Library y se vio al menos dos
veces. Consulta
[Por qué puede no aparecer una conexión](/es/docs/manual/relationships#por-que-puede-no-aparecer-una-conexion).

## He perdido la cuenta del owner

Usa **Forgot password** en la página de inicio de sesión (necesita correo).
Si también has perdido el 2FA, inicia sesión con un código de respaldo. Sin
ninguno de los dos, un administrador del servidor puede ayudar desde la base
de datos — escribe a [support@inframole.com](mailto:support@inframole.com)
para que te orientemos.

## Desinstalar

```sh
docker compose down        # lo detiene todo, conserva los datos
docker compose down -v     # también borra la base de datos y los certificados — irreversible
```

Quita los agentes de tus servidores como se describe en
[Gestionar y desinstalar](/es/docs/agent/manage#desinstalar).

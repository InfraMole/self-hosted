# Troubleshooting

Start with the state of the services and their logs:

```sh
docker compose ps
docker compose logs --tail 100 web
docker compose logs --tail 100 caddy
```

## The site does not load

| Check                  | How                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| All services running   | `docker compose ps` — `web` should be `healthy`. If `migrate` exited with an error, see its logs: `docker compose logs migrate`.                 |
| DNS points here        | `nslookup inframole.example.com` returns this server's public address.                                                                           |
| Ports reachable        | From outside: `curl -I http://inframole.example.com` answers with a redirect to https. Check the firewall and the router / cloud security group. |
| Nothing else on 80/443 | Linux: `sudo ss -ltnp 'sport = :443'`. Windows: see [Free ports 80 and 443](/docs/installation/windows#free-ports-80-and-443).                   |

## Certificate errors

Caddy logs every certificate attempt: `docker compose logs caddy | grep -i
certificate`. The usual causes are a DNS record that does not point at the
server yet, port 80 blocked (needed for the Let's Encrypt challenge), or too
many failed attempts — Let's Encrypt then waits before trying again.

## Emails do not arrive

- `docker compose logs web | grep '\[mail\]'` shows sending errors (never
  message contents).
- Check `SMTP_URL` (`smtps://` for port 465, `smtp://` for 587) and that the
  provider allows the `MAIL_FROM` address.
- Without email, invitation links are shown on screen after inviting.

## An agent does not appear

On the host:

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

| Message                      | Meaning                                                                                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| certificate / x509 error     | The agent does not trust the server certificate (for example `tls internal`). Use a real certificate.                  |
| `401` / unauthorized         | The agent was revoked, or the enrollment token expired before enrolling. Create a new token and install again.         |
| `402` / plan limit           | The plan's server/VM limit is reached (or, on Cloud, the trial ended).                                                 |
| timeout / connection refused | The host cannot reach the server on 443: firewall or proxy (see [proxies](/docs/agent/install#firewalls-and-proxies)). |

## No suggestions appear

Connections become suggestions only when the remote IP belongs to exactly
one resource in the Library and was seen at least twice. See
[Why a connection may not appear](/docs/manual/relationships#why-a-connection-may-not-appear).

## I lost the owner account

Use **Forgot password** on the sign-in page (needs email). If 2FA is lost
too, sign in with a backup code. Without either, an administrator of the
server can help from the database — contact
[support@inframole.com](mailto:support@inframole.com) for guidance.

## Uninstall

```sh
docker compose down        # stops everything, keeps the data
docker compose down -v     # also deletes the database and certificates — irreversible
```

Remove the agents from your servers as described in
[Manage and remove](/docs/agent/manage#uninstall).

# Running SeedCode on the server

SeedCode runs on the shared EC2 server (Amazon Linux 2023) next to other
sites, as three Docker containers behind the server's own nginx:

```
phone / browser ──https──> nginx (host, port 443) ──> app container (127.0.0.1:8010)
                                                          └──> db container (PostgreSQL, no port)
```

| What | Where |
|---|---|
| Code and settings | `/opt/seedcode` (settings in `/opt/seedcode/.env`, readable by root only) |
| nginx site | `/etc/nginx/conf.d/seedcode.conf` (a copy of `deploy/nginx-seedcode.conf`) |
| Certificate | `/etc/letsencrypt/live/seed.skyquestinsights.com/` (certbot; renewed with every site's by `certbot-renew.timer`, and by `seedcode-cert.timer` as a backstop) |
| Database files | Docker volume `seedcode_db-data` |
| Nightly backups | `/var/backups/seedcode`, 7 days kept, by `seedcode-backup.timer` |

Everything here uses its own names (`seedcode`, `seedcode_*`) and port 8010,
so the other sites on the server are not touched.

## Everyday tasks

All as root (`sudo -i`), in `/opt/seedcode`.

| Task | Command |
|---|---|
| Is it up? | `docker compose ps` and `curl -s 127.0.0.1:8010/api/health` |
| Recent errors | `docker compose logs --tail 100 app` |
| Put out a new version | copy the new code into `/opt/seedcode`, then `deploy/update.sh` |
| Restart | `docker compose restart app` |
| Back up now | `deploy/backup.sh` |
| Last backups | `ls -lh /var/backups/seedcode` |

## Restoring a backup

This replaces everything in the database with the copy.

```sh
cd /opt/seedcode
docker compose stop app
gunzip -c /var/backups/seedcode/seedcode-YYYY-MM-DD-HHMM.sql.gz \
  | docker compose exec -T db psql -U seedcode -d seedcode --single-transaction \
      -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' -f -
docker compose up -d
```

## First installation (already done; kept for a new server)

1. Docker with the compose plugin, nginx and certbot installed.
2. Code in `/opt/seedcode`; `.env` from `.env.example` with `PUBLIC_URL`,
   `POSTGRES_PASSWORD` (`openssl rand -hex 24`), `ADMIN_USERNAME` and
   `ADMIN_PASSWORD`; `chmod 600 .env`.
3. `deploy/update.sh`, then sign in once and remove the two `ADMIN_` lines
   from `.env`.
4. Certificate: with a plain port-80 server block for the name in place,
   `certbot certonly --nginx -d seed.skyquestinsights.com`.
5. `cp deploy/nginx-seedcode.conf /etc/nginx/conf.d/seedcode.conf`,
   `nginx -t && systemctl reload nginx`.
6. Backups and renewal: copy `deploy/seedcode-backup.*` and
   `deploy/seedcode-cert.*` to `/etc/systemd/system/`, then
   `systemctl daemon-reload && systemctl enable --now seedcode-backup.timer seedcode-cert.timer`.

Certificates for every site on the server are renewed by `certbot-renew.timer`
(switched on 20 Oct 2026); `/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh`
makes nginx load each renewed certificate.

## Still worth doing

- **Disk.** The server's 8 GB disk was 97% full before SeedCode arrived.
  Growing the EBS volume (to 30 GB, say) protects every site on it; until
  then, keep an eye on `df -h /`.
- **Backups off the server.** Copy `/var/backups/seedcode` to an encrypted
  S3 bucket. The copies hold farmers' ID numbers.
- **The retired shambamap certificate.** `shambamap.skyquestinsights.com`
  no longer exists in DNS and no site uses its certificate, so every renewal
  run reports it as failed. Once that name is surely retired:
  `certbot delete --cert-name shambamap.skyquestinsights.com`.
- **Error alerts.** Nothing yet tells anyone when the site fails; an uptime
  check on `https://seed.skyquestinsights.com/api/health` is the simplest start.

# Operations hardening

This branch keeps operational additions outside the official eLabFTW schema. Start the normal stack with:

```bash
docker compose up -d --build --wait
```

The web health check calls `/healthcheck.php`, so Docker only marks the service healthy after Nginx, PHP and MySQL are available. Runtime ports, URLs, CPU/memory bounds and log rotation can be adjusted in `.env`; see `.env.example`.

## Maintenance

Run fork-owned maintenance manually:

```bash
docker compose --profile maintenance run --rm maintenance
```

Preview retention cleanup without deleting rows:

```bash
docker compose --profile maintenance run --rm maintenance custom:maintenance --dry-run
```

The command uses a MySQL advisory lock, drains the incremental calendar backlog, removes orphaned calendar index rows and prunes completed tasks/history older than 365 days. Use `--retention-days=N` to change retention.

Inspect schemas, calendar backlog, retained tasks and database size with:

```bash
docker compose --profile maintenance run --rm maintenance custom:diagnostics
docker compose --profile maintenance run --rm maintenance custom:diagnostics --json
```

For unattended operation, invoke the first command from a host cron job or systemd timer. The command is safe when an earlier run is still active: the second run exits without doing duplicate work.

## Backup

Create and verify a backup:

```bash
docker compose --profile backup run --rm backup backup
docker compose --profile backup run --rm backup verify
```

Backups are stored below `ELABFTW_BACKUP_PATH` and contain the database, uploads, exports, schema metadata and SHA-256 checksums. Copy this directory to storage outside the Docker host.

Restore is intentionally guarded. Stop the web service, select the backup directory and explicitly authorize the operation:

```bash
docker compose stop web
docker compose --profile backup run --rm \
  -e ALLOW_RESTORE=yes backup restore /backups/elabftw-YYYYMMDDTHHMMSSZ
docker compose up -d --wait
```

Always test restoration on a staging installation before relying on a backup policy.

## Compatibility monitoring

`upstream-merge-check.yml` fetches official eLabFTW weekly and compares the simulated conflicts with `.github/upstream-known-conflicts.txt`. A changed conflict set fails CI and provides the complete merge report as an artifact. It never merges or pushes code.

`custom-database-check.yml` builds a clean installation, applies custom migrations, checks their ledger and verifies that running the migration command again is idempotent.

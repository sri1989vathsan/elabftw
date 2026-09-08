# PyRAT integration

This branch separates experiment linking from animal-facility scoring:

- PyRAT remains authoritative for animals, cages, locations, and welfare records.
- eLabFTW uses a least-privilege read-only service account to browse PyRAT.
- eLabFTW stores only typed links: experiment ID, `animal` or `cage`, and the stable PyRAT ID.
- The scoresheet is independently deployable from `integrations/pyrat-scoresheet` and can remain reachable on the local network when eLabFTW is not.
- eLabFTW can open that scoresheet with `{type}` and `{id}` URL placeholders; adding `view=history` opens the relevant entry table first. No score-submission endpoint exists inside eLabFTW.

## eLabFTW setup

1. Run the normal upstream schema update, then the fork-owned migrations:

   ```bash
   docker exec -it elabftw bin/console db:update
   docker exec -it elabftw bin/console custom:db:update
   ```

2. Open **Sysconfig → Server → PyRAT integration**.
3. Enable the integration and keep demo mode enabled for the first test.
4. Add the eLabFTW team IDs allowed to use PyRAT. An empty list restricts access to sysadmins.
5. For live use, enter the API base URL, authentication, and endpoint paths supplied by the institutional PyRAT administrator.
6. Use a read-only PyRAT credential scoped to only the animals/cages those configured teams are allowed to see.

The adapter normalizes common response field names, but it deliberately does not guess undocumented endpoint paths. Update the mapping in `src/Services/Pyrat/PyratClient.php` after receiving a sanitized institutional response example.

## External scoresheet

```bash
cd integrations/pyrat-scoresheet
cp .env.example .env
# set a long PORTAL_ACCESS_CODE
docker compose up -d --build
```

Expose the service through the institution's HTTPS reverse proxy, VPN, or SSO. A shared access code is provided only as a starter layer; individual authenticated observer identities are preferable for production animal-welfare records.

Start with `PYRAT_DEMO_MODE=true`. Demo submissions are written to `integrations/pyrat-scoresheet/data/submissions.ndjson`. Live writes remain disabled until both an exact score endpoint is configured and `PYRAT_SCORE_WRITE_ENABLED=true` is explicitly set.

The eLabFTW setting can be either a root URL or a template such as:

```text
https://scores.example.org/?entity_type={type}&entity_id={id}
```

## Production gate

Before enabling live score writes, validate all of the following with the animal facility and PyRAT administrator:

- endpoint and request/response schema;
- approved scoring criteria, humane endpoints, and escalation workflow;
- observer identity and audit requirements;
- service-account scope and credential rotation;
- TLS, backups, retention, and monitoring.

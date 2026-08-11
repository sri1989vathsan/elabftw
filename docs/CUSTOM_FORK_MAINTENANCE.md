# Maintaining the customized eLabFTW fork

This branch is based directly on `elabftw/elabftw:master`. The previous fork
state is preserved in `archive/pre-upstream-restructure-20260811`.

## Why custom migrations are separate

The old fork used upstream schema numbers 209–216 for fork features. Upstream
later assigned the same numbers to unrelated official changes. The customized
branch now leaves `src/sql/schema*.sql`, `src/sql/structure.sql`, and
`SchemaVersionChecker::REQUIRED_SCHEMA` under upstream ownership.

Fork database changes live in `src/sql/custom/` and are tracked in the
`custom_schema_migrations` table. Applied files are checksummed and must never
be edited; add a new numbered custom migration instead. This removes migration
number conflicts when upstream adds schema 220, 221, and later versions.

The container entrypoint runs migrations in this order when `AUTO_DB_UPDATE`
is enabled:

1. `bin/console db:update`
2. `bin/console custom:db:update`

For manual deployments, run the same two commands after replacing the image.

## One-time upgrade from the legacy fork database

Back up and verify the database first. The legacy fork reports schema 216 even
though its true upstream base is schema 208. Run:

```sh
docker exec -it elabftw bin/console custom:db:adopt-legacy --confirm
docker exec -it elabftw bin/console db:update
docker exec -it elabftw bin/console custom:db:update
```

The adoption command refuses to run unless it detects the known legacy
signature: reported schema 216, the fork's `html_tools` table present, and the
official schema-209 `storage_units_history` table absent. It changes only the
official schema counter to 208. The next two commands apply the real upstream
migrations and then register or add the fork-owned objects idempotently.

Do not run the adoption command on a fresh database or on a database already
updated from official eLabFTW.

## Pulling future upstream releases

Keep `master` as the deployable integration branch and retain this branch as a
reviewable customization layer. A typical update is:

```sh
git fetch upstream
git switch codex/upstream-compatible-custom
git merge upstream/master
bin/console db:update
bin/console custom:db:update
```

Resolve application conflicts in the small custom adapters, never by modifying
or renumbering upstream migration files. Run the normal upstream test/build
suite plus the fork tests before merging the branch into `master`.

## Integrating with `master`

After validation, merge the branch with a regular merge commit:

```sh
git switch master
git merge --no-ff codex/upstream-compatible-custom
```

For later upstream updates, merge `upstream/master` into the customization
branch first, validate it, then merge that branch into `master`. This keeps the
official upstream ancestry visible and makes repeated updates incremental.

The approach is future-compatible, not conflict-free: UI files that both the
fork and upstream edit can still conflict. Database schema-number collisions
are eliminated, and editor-specific CSS is isolated in `_custom-editor.scss`
to reduce recurring source conflicts.

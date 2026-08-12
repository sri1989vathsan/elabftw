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

The upstream container entrypoint remains unmodified and responsible only for
official eLabFTW initialization and migrations. The fork Compose file invokes
it from the one-shot `migration-init` service in this order:

1. wait for MySQL and storage initialization
2. run the official entrypoint with `AUTO_DB_INIT` and `AUTO_DB_UPDATE`
3. run `bin/console custom:db:update`
4. start `web` only after the migration job completes successfully

For manual deployments, run the same two commands after replacing the image.

## Rules for future custom database changes

Existing custom migrations are immutable because their checksums are recorded
in `custom_schema_migrations`. Do not edit migrations `001` through `007` and
do not move their live data without a separately reviewed compatibility
migration.

New custom features should prefer namespaced tables over generic columns added
to upstream tables. Use names such as:

- `moor_user_settings`
- `moor_entity_settings`
- `moor_todolist_metadata`
- `moor_integration_settings`

Reference the upstream row by its primary key and use `ON DELETE CASCADE` where
the custom metadata has no meaning without that row. If extending an upstream
table is unavoidable, prefix the column and index names with `moor_`.

## Keeping editor customizations mergeable

Fork-owned TinyMCE behavior lives under `src/ts/custom-editor/`. The upstream-
facing `src/ts/tinymce.ts` contains one call to
`registerCustomEditorExtensions()` rather than the implementations for lists,
dates and titles, spreadsheets, table tools, links, format painting and the
table of contents. Add future editor features as another extension module and
register it in `src/ts/custom-editor/index.ts`.

Saved-document and editor-frame styles are shared through
`src/scss/_custom-editor.scss`. It is imported by the application stylesheet
and appended to TinyMCE's content stylesheet during the asset build. Keep it
valid as plain CSS as well as SCSS; do not add Sass-only nesting or variables.

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

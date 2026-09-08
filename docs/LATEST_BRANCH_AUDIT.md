# Latest Branch Audit

**Audit date:** 2026-08-31  
**Custom branch:** `codex/usability-improvements`  
**Audited commit:** `cccdef742645867e93bba961ba7dca606d2d751b`  
**Comparison target:** `github.com/elabftw/elabftw`, current `upstream/master`

This document evaluates the customized eLabFTW branch in three areas:

1. scalability with additional users and data;
2. mergeability with the official eLabFTW repository;
3. installability using only files tracked in Git.

## Executive summary

| Criterion | Assessment |
|---|---|
| Scalability for approximately 20 users | Good |
| Scalability for substantially larger datasets | Moderate; several bottlenecks remain |
| Mergeability with current upstream `master` | Manageable, but requires manual work |
| Buildable from Git alone | Yes; verified with a clean Git archive |
| Fresh database installation | Yes; verified with an isolated MySQL database |
| Custom migration integrity | Passed; 22 applied and 0 pending |
| Exact upstream version parity | No; this branch requires schema 219 while current upstream requires 224 |

## 1. Scalability

For a team of approximately 20 users and 15–20 projects, serious performance
problems are not expected on a reasonably provisioned server.

### Scalability protections already present

- The main card-style experiment/resource list requests bounded pages using
  `limit` and `offset`.
- Tasks, steps, and completed-task history use bounded pagination.
- Calendar activity queries are limited to a maximum 62-day range.
- Dated headings are stored in a materialized custom calendar index instead of
  reparsing every complete experiment body on every calendar request.
- Inline calendar backfilling is capped at 200 changed entities per request.
- Dedicated indexes support calendar date/team/owner queries, deadlines, and
  unfinished steps.
- Sidebar and command-palette searches return capped result sets.
- Command-palette search is debounced and cancels superseded requests.
- Folder-panel HTML is cached in session storage for 30 seconds.
- Slow folder and calendar operations are instrumented.
- Maintenance commands can prune history and drain calendar-index backlogs.
- Docker CPU, memory, and log-rotation limits are configurable.

### Remaining scalability risks

#### Traditional table view loads all entities

The optional AG Grid table view still downloads all matching entries and then
paginates them in the browser. With tens of thousands of records, this can
produce large API responses, increased PHP/MySQL work, greater browser memory
use, and slower filtering and sorting.

The newer card-style list is more scalable and should remain the default.

**Recommended improvement:** implement server-side pagination, sorting, and
filtering for traditional table mode.

#### Complete folder hierarchy generation

The folder sidebar calculates the complete team hierarchy and aggregate counts
together. This is reasonable for hundreds of folders, but may become noticeable
with thousands of folders and very large experiment/resource tables.

**Recommended improvement:** initially load root folders and request child
folders only when a parent is expanded.

#### Initial calendar backfill

Calendar access is incremental after indexing. A large existing installation
can nevertheless have a substantial first-time backlog. The background calendar
backfill command should be run after deployment rather than relying exclusively
on the bounded inline batches.

#### Large individual experiment bodies

Inline spreadsheets and rich tables are stored in the experiment body. A single
experiment containing many large spreadsheets can make TinyMCE slow even when
the database is healthy. This is browser DOM cost, so database pagination does
not solve it.

#### Single-server deployment architecture

The default Compose deployment uses one web container, one MySQL container, and
local Docker volumes. Its default web and database limits are two CPUs and 2 GB
of memory each. This should be sufficient for the expected 20-user laboratory,
but it is not designed for effortless horizontal scaling across multiple hosts.

Shared/object storage and a deliberate multi-instance deployment design would
be required before adding multiple web replicas.

### Scalability conclusion

The branch is suitable for the expected team size. Before supporting hundreds
of simultaneous users or very large datasets, prioritize:

1. server-side pagination for traditional table mode;
2. lazy loading of folder subtrees;
3. shared/object storage for multi-host deployment;
4. scheduled calendar backfilling and maintenance;
5. production query monitoring with representative data.

## 2. Mergeability with official eLabFTW

The audit fetched the latest official `upstream/master` and ran Git's trial
merge without changing the working branch.

### Current divergence

- 89 commits exist only in upstream.
- 215 commits exist only in the custom branch.
- The customization changes 251 files.
- The diff contains approximately 34,540 additions and 655 deletions.

### Current trial-merge conflicts

The trial merge reported seven conflicts:

1. `containers/elabimg/Dockerfile`
2. `src/Services/Filter.php`
3. `src/ts/Metadata.class.ts`
4. `src/ts/spreadsheet-editor.jsx`
5. `src/ts/spreadsheet-utils.ts`
6. `src/ts/tinymce.ts`
7. `tests/unit/models/ExperimentsTest.php`

Git automatically merged the remaining overlapping files during the
simulation.

### Stale compatibility conflict list

`.github/upstream-known-conflicts.txt` currently contains only six files. It
does not contain the new `src/ts/Metadata.class.ts` conflict. The scheduled
upstream compatibility workflow will therefore report a changed conflict set
until that file is added or the conflict is removed by further isolation.

### Database mergeability

Database integration remains the strongest part of the fork architecture:

- the fork does not modify official numbered migration files;
- it does not modify the official schema counter;
- it leaves `src/sql/structure.sql` under upstream ownership;
- its 22 migrations live under `src/sql/custom/`;
- custom migrations use a separate checksum-based tracking table.

This prevents the previous collision in which fork features and upstream
eLabFTW assigned unrelated changes to the same schema numbers.

### Official schema-version difference

The audited branch requires official schema **219**. Current upstream `master`
requires schema **224** and contains official migrations 220–224.

Consequently, merging current upstream `master` is also a database upgrade. If
alpha-era eLabFTW 6 changes are not desired, current `master` should not be
merged blindly. The fork should instead follow a reviewed stable release/tag
whose schema and release status are acceptable.

### Recommended upstream-integration procedure

1. Back up and verify the database, uploads, and exports.
2. Create a dedicated upstream-integration branch.
3. Merge the selected stable upstream tag or `upstream/master`.
4. Resolve the seven known source conflicts.
5. Review official migrations 220–224 before applying them.
6. Run the official database updater first.
7. Run `bin/console custom:db:update`.
8. Run `bin/console custom:db:check`.
9. Run the complete test suite and Git-only Docker build.
10. Manually test spreadsheets, metadata, filtering, TinyMCE, and templates.

### Mergeability conclusion

The branch is mergeable through a controlled integration merge. Separate
custom migrations make database integration substantially safer than the old
fork, but the large editor and sidebar customization means future source
updates will not be entirely automatic.

## 3. Installability from Git alone

Git-only installation was tested rather than inferred.

### Clean-source build test

A clean archive was created directly from audited commit `cccdef742`. It
contained no:

- `.env` file;
- `vendor/` directory;
- `node_modules/` directory;
- locally generated dependencies;
- untracked working-tree files.

The complete Docker image was built from this clean archive.

The build successfully:

- installed 1,462 Yarn packages;
- fetched approximately 901 MiB of JavaScript dependencies;
- compiled the main application and spreadsheet assets;
- installed all locked PHP dependencies;
- generated `vendor/autoload.php` inside the image;
- exported a runnable Docker image.

This confirms that a committed `vendor/` directory is neither present nor
required.

### Fresh database test

The clean Git-built image was connected to a completely empty, isolated MySQL
8.4 database. The official installer completed successfully.

The database then reported:

```text
Current version: 219
Required version: 219
No upgrade required.
```

All custom migrations were applied:

```text
22 custom migrations applied
0 custom migrations pending
```

`custom:db:update` and `custom:db:check` were executed again. The second pass
remained at 22 applied and 0 pending, confirming idempotence.

The isolated test database, Docker network, and audit image were removed after
verification. The deployed installation and its persistent data were not used
or modified.

### Compose validation

`docker-compose.yml` successfully passed `docker compose config --quiet` using
`.env.example` as the environment source. The default services resolved to:

- `mysql`
- `storage-init`
- `migration-init`
- `web`

### Installation caveats

#### A local `.env` file must be created

The repository intentionally does not track secrets. A new administrator must
run:

```bash
cp .env.example .env
```

Every placeholder password and the encryption key must be replaced before the
stack is started. This is compatible with a Git-only installation because
runtime secrets should not be stored in Git.

#### Stale secret-generation image name

The comment in `.env.example` recommends generating a key with the old image
tag `elabftw/elabimg:upstream-compatible-custom`. The current Compose image is
`elabftw/elabimg:codex-usability-improvements`.

The instruction should be updated to prevent confusion during a new install.

#### Composer source-clone mode

The customized Dockerfile currently runs Composer with `--prefer-source`, while
upstream uses distribution archives. The build passed, but source-clone mode:

- takes substantially longer;
- requires many Git repository clone operations;
- is more vulnerable to GitHub/network interruptions;
- consumes additional build time and disk space;
- produced ambiguous Flysystem class-resolution warnings during the audit.

Unless source checkouts are required for a specific customization,
`--prefer-dist` is the safer and faster production-build choice.

#### Build resource requirements

A completely fresh build requires approximately:

- at least 4 GB available for the configured Node heap;
- several additional gigabytes of Docker disk capacity;
- access to Docker Hub, GitHub, Yarn/npm, and Composer sources;
- several minutes of build time.

#### Stale backup image tag

The optional backup service still uses
`elabftw/backup:codex-operations-hardening`. It has a local build definition and
remains buildable, but the tag is inconsistent with the current branch name and
may confuse deployment documentation.

## Final assessment

The latest branch is suitable for the expected 20-person team and is
reconstructable from files tracked in Git alone.

The most important outstanding items are:

1. decide whether to remain on stable schema 219 or integrate upstream
   migrations 220–224;
2. resolve the seven current source conflicts on an integration branch;
3. add `src/ts/Metadata.class.ts` to the compatibility conflict baseline or
   isolate the customization that causes the conflict;
4. implement server-side pagination for traditional table mode;
5. consider lazy folder subtree loading for very large teams;
6. restore Composer `--prefer-dist` unless source clones are explicitly needed;
7. correct stale image names in `.env.example` and the backup service.


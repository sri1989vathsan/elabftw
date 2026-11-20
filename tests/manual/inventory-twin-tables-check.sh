#!/usr/bin/env bash
# Check of the twin tables of the Database (inventory, inventory_steps, ...), see ELABFTW-CUSTOMIZATIONS-INVENTORY.md, "Twin tables".
#
# Starts a throwaway MySQL (own container, nothing published, removed at the end), then builds two databases and runs the REAL
# CustomMigrationRunner (tests/manual/inventory-twin-tables-runner.php, inside an elabimg container with this checkout's src mounted):
#   upg    the history of an UPGRADED install: upstream's structure.sql at the fork's merge-base, the fork migrations that existed before the
#          twin tables were spelled out, then upstream's newer schema files and uuid migrations, then the runner (every migration of today)
#   fresh  a FRESH install of the merged code: upstream/master's structure.sql, then the runner
# and asserts: the runner succeeds on both and a second run does nothing; on fresh, 110/111 were recorded without running and inv_003 ran in
# their place; every twin table is identical (SHOW CREATE TABLE: columns, order, types, defaults, keys) in the two databases; nothing registered
# after 111 says `LIKE`.
#
#   tests/manual/inventory-twin-tables-check.sh            (run `git fetch upstream` first; UPSTREAM_REF overrides upstream/master)
#   IMAGE=elabftw/elabimg:inventory MYSQL_IMAGE=mysql:8.4  (the defaults)
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
UPSTREAM_REF="${UPSTREAM_REF:-upstream/master}"
IMAGE="${IMAGE:-elabftw/elabimg:inventory}"
MYSQL_IMAGE="${MYSQL_IMAGE:-mysql:8.4}"
NAME="twin-check-$$"
WORK="$(mktemp -d)"
FAIL=0

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1; rm -rf "$WORK"; }
trap cleanup EXIT

ok() { printf 'ok    %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAIL=$((FAIL + 1)); }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected '$3', got '$2')"; fi; }
sql() { docker exec -i "$NAME" mysql -uroot -ppw "$@" 2>&1 | grep -v 'Using a password'; }
sqlq() { sql -N -e "$1" </dev/null; }
runner() { # database mode
    docker run --rm --network "container:$NAME" -e DB_HOST=127.0.0.1 -e DB_PORT=3306 -e "DB_NAME=$1" -e DB_USER=root -e DB_PASSWORD=pw -e SECRET_KEY=x \
        -v "$ROOT/src":/elabftw/src:ro -v "$ROOT/tests/manual/inventory-twin-tables-runner.php":/r.php:ro \
        --entrypoint php "$IMAGE" -d open_basedir= -d display_errors=stderr /r.php "$2" 2>&1 | grep -v 's3_exports_toggle' | grep -v '^$'
}

git rev-parse --verify -q "$UPSTREAM_REF" >/dev/null || { echo "no $UPSTREAM_REF: git fetch upstream"; exit 2; }
BASE="$(git merge-base HEAD "$UPSTREAM_REF")"

# the twin tables: name of the table of the resources, name of its twin
cat > "$WORK/pairs.txt" <<'EOF'
items inventory
items_categories inventory_categories
items_status inventory_status
items_changelog inventory_changelog
items_comments inventory_comments
items_revisions inventory_revisions
items_edit_mode inventory_edit_mode
pin_items2users pin_inventory2users
items2items inventory2inventory
items2experiments inventory2experiments
experiments2items experiments2inventory
compounds2items compounds2inventory
containers2items containers2inventory
items_steps inventory_steps
items_request_actions inventory_request_actions
EOF

echo "== upstream files from $UPSTREAM_REF (merge-base $BASE)"
git show "$BASE:src/sql/structure.sql" > "$WORK/base_structure.sql"
git show "$UPSTREAM_REF:src/sql/structure.sql" > "$WORK/up_structure.sql"
mkdir "$WORK/up"
# what upstream added after the merge-base: its schemaNNN.sql above the one of the base, then its uuid migrations (sorted by name, which is time order)
BASE_SCHEMA="$(git show "$BASE:src/Elabftw/SchemaVersionChecker.php" | sed -n 's/.*REQUIRED_SCHEMA = \([0-9]*\);.*/\1/p')"
for f in $(git ls-tree --name-only -r "$UPSTREAM_REF" src/sql | grep -E 'src/sql/schema[0-9]+\.sql$'); do
    n="$(basename "$f" .sql)"; n="${n#schema}"
    [ "$n" -gt "$BASE_SCHEMA" ] && git show "$UPSTREAM_REF:$f" > "$WORK/up/1_schema$(printf '%04d' "$n").sql"
done
for f in $(git ls-tree --name-only -r "$UPSTREAM_REF" src/sql | grep -E 'src/sql/migration-.*[^n]\.sql$' | grep -v '\.down\.sql$'); do
    git show "$UPSTREAM_REF:$f" > "$WORK/up/2_$(basename "$f")"
done
echo "   merge-base schema $BASE_SCHEMA, $(ls "$WORK/up" | wc -l | tr -d ' ') upstream files to apply"

echo "== throwaway MySQL ($MYSQL_IMAGE, container $NAME)"
docker run -d --name "$NAME" -e MYSQL_ROOT_PASSWORD=pw "$MYSQL_IMAGE" >/dev/null || exit 2
for _ in $(seq 1 60); do docker exec "$NAME" mysqladmin -uroot -ppw ping 2>/dev/null | grep -q alive && break; sleep 2; done
sleep 3
sql -e "CREATE DATABASE upg; CREATE DATABASE fresh;"

echo "== UPGRADED install"
sql upg < "$WORK/base_structure.sql"
out="$(runner upg old | tail -1)"; echo "   old history: $out"
for f in $(ls "$WORK/up" | sort); do
    err="$(sql upg < "$WORK/up/$f" | grep ERROR)"
    [ -n "$err" ] && bad "upstream file $f on the upgraded database: $err"
done
check "upgraded: items_revisions is gone (upstream dropped it)" "$(sqlq "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='upg' AND TABLE_NAME='items_revisions'")" "0"
out="$(runner upg full | tail -1)"; echo "   $out"
check "upgraded: the runner applies exactly the 8 new migrations (inv_003 no-op, inv_004..010)" "$(echo "$out" | sed -n 's/^applied \([0-9]*\),.*/\1/p')" "8"
out="$(runner upg full | tail -1)"
check "upgraded: second run applies nothing" "$(echo "$out" | sed -n 's/^applied \([0-9]*\),.*/\1/p')" "0"

echo "== FRESH install of the merged code"
sql fresh < "$WORK/up_structure.sql"
out="$(runner fresh full | tail -3)"; echo "   $out"
check "fresh: runner succeeded" "$(echo "$out" | grep -c '^applied')" "1"
check "fresh: 110, 111 and inv_003 are in the ledger" "$(sqlq "SELECT COUNT(*) FROM fresh.custom_schema_migrations WHERE migration IN ('110_inventory.sql','111_inventory_steps.sql','inv_003_twin_tables.sql')")" "3"
out="$(runner fresh full | tail -1)"
check "fresh: second run applies nothing" "$(echo "$out" | sed -n 's/^applied \([0-9]*\),.*/\1/p')" "0"
check "fresh: ledger has the same migrations as the upgraded one" \
    "$(sqlq "SELECT migration FROM fresh.custom_schema_migrations ORDER BY 1" | cksum)" "$(sqlq "SELECT migration FROM upg.custom_schema_migrations ORDER BY 1" | cksum)"
check "fresh: items_revisions does not exist and nothing created it" "$(sqlq "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='fresh' AND TABLE_NAME='items_revisions'")" "0"

echo "== twin tables: fresh against upgraded"
while read -r src twin; do
    a="$(sqlq "SHOW CREATE TABLE fresh.$twin")"
    b="$(sqlq "SHOW CREATE TABLE upg.$twin")"
    if [ -z "$a" ]; then bad "$twin missing on fresh"; elif [ "$a" = "$b" ]; then ok "$twin identical"; else bad "$twin differs"; diff <(echo "$a" | sed 's/\\n/\n/g') <(echo "$b" | sed 's/\\n/\n/g') | head -8; fi
done < "$WORK/pairs.txt"
# the tables the later migrations (112 and following) create or alter: every table with inventory, registry or storage in its name that is the fork's
for t in $(sqlq "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='fresh' AND (TABLE_NAME LIKE 'inventory%' OR TABLE_NAME LIKE 'registry%' OR TABLE_NAME LIKE '%2inventory' OR TABLE_NAME LIKE 'custom\\_%') ORDER BY 1"); do
    a="$(sqlq "SHOW CREATE TABLE fresh.$t")"; b="$(sqlq "SHOW CREATE TABLE upg.$t")"
    [ "$a" = "$b" ] || bad "fork table $t differs between fresh and upgraded"
done

echo "== search index and scope column: same on both paths (SHOW CREATE TABLE above includes the keys; these name what must be there)"
for d in fresh upg; do
    check "$d: inventory has a FULLTEXT index on exactly (title, body, elabid), the one MATCH(title, body, elabid) needs" \
        "$(sqlq "SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='$d' AND TABLE_NAME='inventory' AND INDEX_TYPE='FULLTEXT' GROUP BY INDEX_NAME HAVING GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX)='title,body,elabid'")" "title,body,elabid"
    check "$d: inventory still has the metadata_search column" "$(sqlq "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$d' AND TABLE_NAME='inventory' AND COLUMN_NAME='metadata_search'")" "1"
    check "$d: a MATCH(title, body, elabid) query runs (no error 1191)" "$(sql -N -e "SELECT COUNT(*) FROM $d.inventory WHERE MATCH(title, body, elabid) AGAINST ('zzz' IN BOOLEAN MODE)" | grep -c ERROR)" "0"
    check "$d: users.moor_scope_inventory is TINYINT UNSIGNED NOT NULL DEFAULT 2" "$(sqlq "SELECT CONCAT(COLUMN_TYPE,'/',IS_NULLABLE,'/',COLUMN_DEFAULT) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$d' AND TABLE_NAME='users' AND COLUMN_NAME='moor_scope_inventory'")" "tinyint unsigned/NO/2"
done
check "inventory keys are identical on fresh and upgraded" \
    "$(sqlq "SELECT INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME, INDEX_TYPE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='fresh' AND TABLE_NAME='inventory' ORDER BY 1,2" | cksum)" \
    "$(sqlq "SELECT INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME, INDEX_TYPE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA='upg' AND TABLE_NAME='inventory' ORDER BY 1,2" | cksum)"

echo "== no new LIKE <table>"
check "no inv_ migration says LIKE (comments aside)" "$(grep -vh '^--' src/sql/custom/inv_*.sql | grep -ic 'create table[^;]* like ')" "0"

echo
if [ "$FAIL" -eq 0 ]; then echo "ALL OK"; else echo "$FAIL FAILED"; exit 1; fi

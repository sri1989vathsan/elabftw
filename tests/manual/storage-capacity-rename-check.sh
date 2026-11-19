#!/usr/bin/env bash
# Fork check: inv_002_storage_unit_moor_capacity.sql against a throwaway MySQL (docker). Usage: tests/manual/storage-capacity-rename-check.sh
# Cases: A) 132 ran (SMALLINT capacity with data) -> renamed, data and type kept, re-run no-op
#        B) upstream-style: capacity INT, no moor_capacity -> moor_capacity created, capacity untouched, re-run no-op
#        C) no capacity at all -> moor_capacity created
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NAME="capcheck-$$"
IMAGE="${MYSQL_IMAGE:-mysql:8.4}"
docker run -d --rm --name "$NAME" -e MYSQL_ROOT_PASSWORD=pw "$IMAGE" >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
q() { docker exec -i "$NAME" mysql -uroot -ppw -N -B "$@" 2>/dev/null; }
for _ in $(seq 60); do q -e 'SELECT 1' >/dev/null 2>&1 && break; sleep 2; done
fail=0
ok() { echo "ok   - $1"; }
ko() { echo "FAIL - $1"; fail=1; }
check() { [ "$2" = "$3" ] && ok "$1" || ko "$1 (expected '$3', got '$2')"; }
run() { q "$1" < "$ROOT/src/sql/custom/inv_002_storage_unit_moor_capacity.sql" >/dev/null; }
coltype() { q -e "SELECT COLUMN_TYPE, IS_NULLABLE, IFNULL(COLUMN_DEFAULT,'NULL') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$1' AND TABLE_NAME='storage_units' AND COLUMN_NAME='$2'"; }
mk() { q -e "CREATE DATABASE $1; CREATE TABLE $1.storage_units (id INT UNSIGNED PRIMARY KEY, name VARCHAR(255), child_capacity SMALLINT UNSIGNED NULL);"; }

# A: the state after 132
mk a; q a -e "$(sed -n '/^SET/,$p' "$ROOT/src/sql/custom/132_storage_unit_capacity.sql")"
q a -e "INSERT INTO storage_units(id,name,child_capacity,capacity) VALUES (1,'freezer',4,12),(2,'rack',NULL,NULL),(3,'box',2,65535)"
before=$(coltype a capacity)
run a
check "A: capacity gone" "$(coltype a capacity)" ""
check "A: moor_capacity has the same type/null/default" "$(coltype a moor_capacity)" "$before"
check "A: data kept" "$(q a -e 'SELECT GROUP_CONCAT(IFNULL(moor_capacity,"n") ORDER BY id) FROM storage_units')" "12,n,65535"
check "A: child_capacity untouched" "$(q a -e 'SELECT GROUP_CONCAT(IFNULL(child_capacity,"n") ORDER BY id) FROM storage_units')" "4,n,2"
run a; run a
check "A: re-run is a no-op (data)" "$(q a -e 'SELECT GROUP_CONCAT(IFNULL(moor_capacity,"n") ORDER BY id) FROM storage_units')" "12,n,65535"
check "A: re-run keeps a single column" "$(q a -e "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='a' AND TABLE_NAME='storage_units' AND COLUMN_NAME LIKE '%capacity'")" "2"

# B: upstream schema220 style: capacity INT UNSIGNED (container limit), no moor_capacity
mk b; q b -e "ALTER TABLE storage_units ADD COLUMN capacity INT UNSIGNED NULL DEFAULT NULL; INSERT INTO storage_units(id,name,capacity) VALUES (1,'u',7)"
run b
check "B: upstream capacity untouched (type)" "$(coltype b capacity)" "$(printf 'int unsigned\tYES\tNULL')"
check "B: upstream capacity untouched (data)" "$(q b -e 'SELECT capacity FROM storage_units')" "7"
check "B: moor_capacity created" "$(coltype b moor_capacity)" "$(printf 'smallint unsigned\tYES\tNULL')"
run b
check "B: re-run no-op" "$(q b -e 'SELECT capacity FROM storage_units')|$(coltype b moor_capacity)" "7|$(printf 'smallint unsigned\tYES\tNULL')"

# C: neither column
mk c; run c
check "C: moor_capacity created" "$(coltype c moor_capacity)" "$(printf 'smallint unsigned\tYES\tNULL')"
check "C: no capacity invented" "$(coltype c capacity)" ""

[ "$fail" = 0 ] && echo "ALL OK" || { echo "FAILURES"; exit 1; }

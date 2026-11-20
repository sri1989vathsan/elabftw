#!/usr/bin/env bash
# Regression check of three failures of the Database (inventory) branch, against a running stack (never the live one: it creates entries, folders):
#   1. text search: GET /api/v2/inventory?q=... gave 500 "Can't find FULLTEXT index matching the column list" (inv_009)
#   2. scope: the Database list listed the entries of every team ("Undefined array key scope_inventory"; inv_010 users.moor_scope_inventory)
#   3. create with a bad folder_id: 500 FK error and an orphan entry; now 404 and no row (experiments, resources, Database entries)
#
# Needs two users in two different teams with API keys, and a way to count rows:
#   BASE=https://localhost:8983 KEY_A=<id-key of a user of team 1> KEY_B=<id-key of a user of team 2> \
#   MYSQL='docker exec -i <mysql container> mysql -uroot -p<pw> elabftw -N' [PAGE_LOGIN='email:password'] [WEB_CONTAINER=<name>]  tests/manual/inventory-fixes-check.sh
# The entry of team B is readable by everybody (canread_base 50), so only the scope of the list keeps it out of the list of team A.
set -uo pipefail
BASE="${BASE:?BASE}"; KEY_A="${KEY_A:?KEY_A}"; KEY_B="${KEY_B:?KEY_B}"; MYSQL="${MYSQL:?MYSQL}"
TAG="fx$(date +%s)"
FAIL=0
ok() { printf 'ok    %s\n' "$1"; }
bad() { printf 'FAIL  %s\n' "$1"; FAIL=$((FAIL + 1)); }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected '$3', got '$2')"; fi; }
api() { # key method path [json] -> prints "status|location|body-file"
    local out; out="$(mktemp)"
    local hdr; hdr="$(curl -sk -o "$out" -D - -X "$2" -H "Authorization: $1" -H 'Content-Type: application/json' ${4:+-d "$4"} "$BASE/api/v2/$3")"
    printf '%s|%s|%s\n' "$(echo "$hdr" | head -1 | awk '{print $2}')" "$(echo "$hdr" | grep -i '^location:' | tr -d '\r' | sed 's/.*\///')" "$out"
}
idsof() { python3 -c 'import json,sys; print(" ".join(str(e["id"]) for e in json.load(open(sys.argv[1]))))' "$1" 2>/dev/null; }
count() { $MYSQL -e "SELECT COUNT(*) FROM $1 WHERE title = '$2'" 2>/dev/null | tail -1; }
SINCE="$(date -u +%Y-%m-%dT%H:%M:%S)"

echo "== 1. text search"
IFS='|' read -r st loc _ <<<"$(api "$KEY_A" POST inventory "{\"title\":\"$TAG searchable plasmid\"}")"; E1="$loc"
check "a Database entry can be created" "$st" "201"
IFS='|' read -r st _ f <<<"$(api "$KEY_A" GET "inventory?q=$TAG")"
check "GET /api/v2/inventory?q=<word> is 200 (was 500, MySQL 1191)" "$st" "200"
case " $(idsof "$f") " in *" $E1 "*) ok "the search finds the entry";; *) bad "the search does not find entry $E1 (got: $(idsof "$f"))";; esac
IFS='|' read -r st _ f <<<"$(api "$KEY_A" GET "inventory?q=$TAG&limit=5&order=lastchange&sort=desc")"
check "search with order and limit is 200" "$st" "200"
IFS='|' read -r st _ f <<<"$(api "$KEY_A" GET "experiments?q=$TAG")"
check "text search of the experiments still 200 (control)" "$st" "200"
IFS='|' read -r st _ f <<<"$(api "$KEY_A" GET "items?q=$TAG")"
check "text search of the resources still 200 (control)" "$st" "200"
if [ -n "${PAGE_LOGIN:-}" ]; then
    jar="$(mktemp)"
    cs="$(curl -sk -c "$jar" -b "$jar" "$BASE/login.php" | grep -o "name='csrf' value='[^']*'" | head -1 | sed "s/.*value='//;s/'//")"
    curl -sk -c "$jar" -b "$jar" -X POST --data-urlencode "csrf=$cs" --data-urlencode "email=${PAGE_LOGIN%%:*}" --data-urlencode "password=${PAGE_LOGIN#*:}" -d "auth_type=local" "$BASE/app/controllers/LoginController.php" -o /dev/null
    for p in "registry.php?q=$TAG" "registry.php"; do
        check "page $p is 200" "$(curl -sk -b "$jar" -o /dev/null -w '%{http_code}' "$BASE/$p")" "200"
    done
    st="$(curl -sk -b "$jar" -o /dev/null -w '%{http_code}' -H 'X-Requested-With: XMLHttpRequest' "$BASE/api/v2/inventory?q=$TAG")"
    check "the same search with the session of the page is 200" "$st" "200"
fi

echo "== 2. scope: a user of team A does not list the entries of team B"
IFS='|' read -r st loc _ <<<"$(api "$KEY_B" POST inventory "{\"title\":\"$TAG team B entry\"}")"; EB="$loc"
check "a user of team B creates an entry" "$st" "201"
$MYSQL -e "UPDATE inventory SET canread_base = 50 WHERE id = $EB" >/dev/null 2>&1   # readable by everybody: only the scope of the list keeps it out
IFS='|' read -r st _ f <<<"$(api "$KEY_A" GET "inventory?limit=500")"
check "team A lists the Database: 200" "$st" "200"
case " $(idsof "$f") " in *" $EB "*) bad "team A lists the entry $EB of team B by default";; *) ok "team A does not list the entry of team B by default";; esac
case " $(idsof "$f") " in *" $E1 "*) ok "team A lists its own entry";; *) bad "team A does not list its own entry $E1";; esac
IFS='|' read -r st _ f <<<"$(api "$KEY_B" GET "inventory?limit=500")"
case " $(idsof "$f") " in *" $EB "*) ok "team B lists its own entry";; *) bad "team B does not list its own entry";; esac
case " $(idsof "$f") " in *" $E1 "*) bad "team B lists the entry $E1 of team A by default";; *) ok "team B does not list the entry of team A by default";; esac
IFS='|' read -r st _ f <<<"$(api "$KEY_A" GET "inventory?limit=500&scope=3")"
case " $(idsof "$f") " in *" $EB "*) ok "scope=3 (everything) still lists the other team (explicit choice)";; *) bad "scope=3 does not list the other team";; esac
if [ -n "${WEB_CONTAINER:-}" ]; then
    check "no 'Undefined array key scope_inventory' in the web log since the start of this check" \
        "$(docker logs --since "$SINCE" "$WEB_CONTAINER" 2>&1 | grep -c 'Undefined array key "scope_inventory"')" "0"
fi

echo "== 3. create with a folder that does not exist / is not usable: 404, no row"
BAD="ZZ bad folder $TAG"
for ep in experiments items inventory; do
    tbl="$ep"
    IFS='|' read -r st _ _ <<<"$(api "$KEY_A" POST "$ep" "{\"title\":\"$BAD $ep\",\"folder_id\":99999999}")"
    check "$ep: POST with a nonexistent folder_id is 404" "$st" "404"
    check "$ep: no orphan row was created" "$(count "$tbl" "$BAD $ep")" "0"
done
# a folder of another team
IFS='|' read -r st FB _ <<<"$(api "$KEY_B" POST experiments_folders "{\"name\":\"$TAG folder B\",\"parent_id\":null}")"; FB="${FB:-}"
IFS='|' read -r st loc _ <<<"$(api "$KEY_B" POST experiments_folders "{\"name\":\"$TAG folder B2\",\"parent_id\":null}")"; FB="$loc"
check "team B has a folder" "$([ -n "$FB" ] && echo yes || echo no)" "yes"
for ep in experiments items; do
    IFS='|' read -r st _ _ <<<"$(api "$KEY_A" POST "$ep" "{\"title\":\"$BAD other-team $ep\",\"folder_id\":$FB}")"
    check "$ep: a folder of another team is refused (404)" "$st" "404"
    check "$ep: ... and leaves no row" "$(count "$ep" "$BAD other-team $ep")" "0"
done
# the trees are separate: an experiments folder for a Database entry, a Database folder for an experiment
IFS='|' read -r st loc _ <<<"$(api "$KEY_A" POST experiments_folders "{\"name\":\"$TAG exp folder\",\"parent_id\":null}")"; FE="$loc"
IFS='|' read -r st loc _ <<<"$(api "$KEY_A" POST experiments_folders "{\"name\":\"$TAG db folder\",\"parent_id\":null,\"scope\":\"inventory\"}")"; FD="$loc"
IFS='|' read -r st _ _ <<<"$(api "$KEY_A" POST inventory "{\"title\":\"$BAD wrong-tree inventory\",\"folder_id\":$FE}")"
check "inventory: a folder of the experiments tree is refused (404)" "$st" "404"
check "inventory: ... and leaves no row" "$(count inventory "$BAD wrong-tree inventory")" "0"
IFS='|' read -r st _ _ <<<"$(api "$KEY_A" POST experiments "{\"title\":\"$BAD wrong-tree experiment\",\"folder_id\":$FD}")"
check "experiments: a folder of the Database tree is refused (404)" "$st" "404"
check "experiments: ... and leaves no row" "$(count experiments "$BAD wrong-tree experiment")" "0"
# the good cases still work
IFS='|' read -r st loc _ <<<"$(api "$KEY_A" POST experiments "{\"title\":\"$TAG good exp\",\"folder_id\":$FE}")"
check "experiments: a good folder still works (201)" "$st" "201"
check "experiments: the experiment is in the folder" "$($MYSQL -e "SELECT folder_id FROM experiments WHERE id = $loc" 2>/dev/null | tail -1)" "$FE"
IFS='|' read -r st loc _ <<<"$(api "$KEY_A" POST items "{\"title\":\"$TAG good item\",\"folder_id\":$FE}")"
check "resources: a good folder still works (201)" "$st" "201"
IFS='|' read -r st loc _ <<<"$(api "$KEY_A" POST inventory "{\"title\":\"$TAG good entry\",\"folder_id\":$FD}")"
check "inventory: a good Database folder still works (201)" "$st" "201"
check "inventory: the entry is in the folder" "$($MYSQL -e "SELECT folder_id FROM inventory WHERE id = $loc" 2>/dev/null | tail -1)" "$FD"
echo
if [ "$FAIL" -eq 0 ]; then echo "ALL OK"; else echo "$FAIL FAILED"; exit 1; fi

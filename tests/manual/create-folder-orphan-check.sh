#!/usr/bin/env bash
# Create with a folder_id that does not exist or is not usable (a folder of another team): 404 and NO row left behind (the entry used to be
# inserted first and the folder checked afterwards, leaving an orphan "ZZ bad folder" entry). Experiments and resources. Against a running stack
# (never the live one: it creates entries and folders).
#
# Needs two users in two different teams with API keys (KEY_B only owns the foreign folder), and a way to count rows:
#   BASE=https://localhost:8983 KEY_A=<id-key of a user of team 1> KEY_B=<id-key of a user of team 2> \
#   MYSQL='docker exec -i <mysql container> mysql -uroot -p<pw> elabftw -N'  tests/manual/inventory-fixes-check.sh
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

echo "== create with a folder that does not exist / is not usable: 404, no row"
BAD="ZZ bad folder $TAG"
for ep in experiments items; do
    IFS='|' read -r st _ _ <<<"$(api "$KEY_A" POST "$ep" "{\"title\":\"$BAD $ep\",\"folder_id\":99999999}")"
    check "$ep: POST with a nonexistent folder_id is 404" "$st" "404"
    check "$ep: no orphan row was created" "$(count "$ep" "$BAD $ep")" "0"
done
IFS='|' read -r st loc _ <<<"$(api "$KEY_B" POST experiments_folders "{\"name\":\"$TAG folder B\",\"parent_id\":null}")"; FB="$loc"
check "team B has a folder" "$([ -n "$FB" ] && echo yes || echo no)" "yes"
for ep in experiments items; do
    IFS='|' read -r st _ _ <<<"$(api "$KEY_A" POST "$ep" "{\"title\":\"$BAD other-team $ep\",\"folder_id\":$FB}")"
    check "$ep: a folder of another team is refused (404)" "$st" "404"
    check "$ep: ... and leaves no row" "$(count "$ep" "$BAD other-team $ep")" "0"
done
IFS='|' read -r st loc _ <<<"$(api "$KEY_A" POST experiments_folders "{\"name\":\"$TAG exp folder\",\"parent_id\":null}")"; FE="$loc"
IFS='|' read -r st loc _ <<<"$(api "$KEY_A" POST experiments "{\"title\":\"$TAG good exp\",\"folder_id\":$FE}")"
check "experiments: a good folder still works (201)" "$st" "201"
check "experiments: the experiment is in the folder" "$($MYSQL -e "SELECT folder_id FROM experiments WHERE id = $loc" 2>/dev/null | tail -1)" "$FE"
IFS='|' read -r st loc _ <<<"$(api "$KEY_A" POST items "{\"title\":\"$TAG good item\",\"folder_id\":$FE}")"
check "resources: a good folder still works (201)" "$st" "201"
check "resources: the resource is in the folder" "$($MYSQL -e "SELECT folder_id FROM items WHERE id = $loc" 2>/dev/null | tail -1)" "$FE"
echo
if [ "$FAIL" -eq 0 ]; then echo "ALL OK"; else echo "$FAIL FAILED"; exit 1; fi

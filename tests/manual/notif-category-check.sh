#!/usr/bin/env bash
# Check for migration 158 (fork notification categories moved to 1000+).
#   tests/manual/notif-category-check.sh
# Needs docker (images mysql:8.4 and php:8.4-cli). Starts a throwaway MySQL (name notif-cat-check, port 3399, removed
# at the end), loads old-numbered fork rows plus upstream-style rows, runs src/sql/custom/158_*.sql twice and asserts:
#   - fork rows (15,16,17,18,19,100..107) moved by +1000, nothing else changed (ids, users, bodies, other categories)
#   - a second run is a no-op
# Then, with php:8.4-cli, checks the enum: round trip value -> case, fork cases only in 1000-1999, upstream's 15/16/100
# are free, every case has a Transform::notif() arm and every bell icon key is a real case value.
set -euo pipefail
cd "$(dirname "$0")/../.."
NAME=notif-cat-check; PORT=3399; fail=0
ok() { echo "ok   $1"; }; ko() { echo "FAIL $1"; fail=1; }
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT; cleanup
docker run -d --name "$NAME" -e MYSQL_ROOT_PASSWORD=x -e MYSQL_DATABASE=t -p "127.0.0.1:$PORT:3306" mysql:8.4 >/dev/null
# the image starts a temporary init server first (port: 0); the real one logs "port: 3306"
for i in $(seq 90); do docker logs "$NAME" 2>&1 | grep -q "ready for connections.*port: 3306" && break; sleep 2; done
q() { docker exec -i "$NAME" mysql -uroot -px t -N -B 2>/dev/null; }
q <<'S'
CREATE TABLE notifications (id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY, userid INT NOT NULL, category TINYINT UNSIGNED NOT NULL, send_email TINYINT NOT NULL DEFAULT 0, body JSON NULL, is_ack TINYINT NOT NULL DEFAULT 0);
S
# the real column is wider than tinyint once values reach 1000+: keep the test table honest about that
q <<'S'
ALTER TABLE notifications MODIFY category SMALLINT UNSIGNED NOT NULL;
INSERT INTO notifications (userid, category, body, is_ack) VALUES
 (1,15,'{"a":1}',0),(1,16,'{"a":2}',0),(2,18,'{"a":3}',1),(2,100,'{"a":4}',0),(3,101,'{"a":5}',0),
 (3,17,'{}',0),(3,19,'{}',0),(3,102,'{}',0),(3,103,'{}',0),(3,104,'{}',0),(3,105,'{}',0),(3,106,'{}',0),(3,107,'{}',0),
 (4,10,'{"u":1}',0),(4,13,'{"u":2}',0),(4,20,'{"u":3}',0),(4,90,'{"u":4}',0),(4,1200,'{"x":1}',0);
S
before_other=$(echo "SELECT id,userid,category,body,is_ack FROM notifications WHERE category NOT IN (15,16,17,18,19,100,101,102,103,104,105,106,107) ORDER BY id" | q)
before_fork=$(echo "SELECT id,userid,category+1000,body,is_ack FROM notifications WHERE category IN (15,16,17,18,19,100,101,102,103,104,105,106,107) ORDER BY id" | q)
q < src/sql/custom/158_notification_category_range.sql
after_fork=$(echo "SELECT id,userid,category,body,is_ack FROM notifications WHERE id IN (SELECT id FROM notifications) AND category IN (1015,1016,1017,1018,1019,1100,1101,1102,1103,1104,1105,1106,1107) AND id <= 17 ORDER BY id" | q)
after_other=$(echo "SELECT id,userid,category,body,is_ack FROM notifications WHERE category NOT IN (1015,1016,1017,1018,1019,1100,1101,1102,1103,1104,1105,1106,1107) ORDER BY id" | q)
[ "$before_fork" = "$after_fork" ] && ok "fork rows moved by +1000 (13 rows)" || ko "fork rows: expected [$before_fork] got [$after_fork]"
[ "$before_other" = "$(echo "$after_other")" ] && ok "other rows unchanged" || ko "other rows changed"
left=$(echo "SELECT COUNT(*) FROM notifications WHERE category IN (15,16,17,18,19,100,101,102,103,104,105,106,107)" | q)
[ "$left" = 0 ] && ok "no row left on an old number" || ko "$left rows still on old numbers"
snap=$(echo "SELECT id,category FROM notifications ORDER BY id" | q)
q < src/sql/custom/158_notification_category_range.sql
[ "$snap" = "$(echo "SELECT id,category FROM notifications ORDER BY id" | q)" ] && ok "second run is a no-op" || ko "second run changed rows"
# enum / template / Transform checks
out=$(docker run --rm -v "$PWD:/app:ro" php:8.4-cli php -r '
require "/app/src/Enums/Notifications.php";
use Elabftw\Enums\Notifications as N;
$bad = array(); $fork = array("TodoDeadline"=>1015,"MentionedInTask"=>1016,"MentionedInOrder"=>1017,"TaskAssigned"=>1018,"OrderStatusChanged"=>1019,
 "OrderReminder"=>1100,"OrderChanged"=>1101,"MentionedInFeedback"=>1102,"AnnouncementPublished"=>1103,"AccessGranted"=>1104,"MentionedInEntry"=>1105,"StepFinished"=>1106,"StepAssigned"=>1107);
$transform = file_get_contents("/app/src/Services/Transform.php"); $factory = file_get_contents("/app/src/Factories/NotificationsFactory.php");
$head = file_get_contents("/app/src/templates/head.html");
foreach (N::cases() as $c) {
  if (N::from($c->value) !== $c) $bad[] = "roundtrip ".$c->name;
  if (isset($fork[$c->name])) { if ($c->value !== $fork[$c->name]) $bad[] = "mapping ".$c->name; }
  elseif ($c->value >= 1000) $bad[] = "unexpected 1000+ ".$c->name;
  if (in_array($c->value, array(15,16,100), true)) $bad[] = "upstream number used ".$c->name;
  if (!str_contains($transform, "Notifications::".$c->name." =>")) $bad[] = "no Transform arm ".$c->name;
}
foreach ($fork as $n => $v) if (N::tryFrom($v)?->name !== $n) $bad[] = "fork case missing ".$n;
preg_match("/set notifIcons = \{(.*?)\} %\}/s", $head, $m); preg_match_all("/^\s*(\d+): \{/m", $m[1], $keys);
foreach ($keys[1] as $k) if (N::tryFrom((int)$k) === null) $bad[] = "bell icon key without case ".$k;
foreach (array(1015,1016,1017,1018,1019,1104) as $k) if (!in_array((string)$k, $keys[1], true)) $bad[] = "bell icon missing ".$k;
echo $bad ? implode("\n", $bad) : "ALLGOOD";')
[ "$out" = ALLGOOD ] && ok "enum: round trip, ranges, Transform arms, bell icon keys" || ko "enum: $out"
exit $fail

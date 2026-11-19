-- Fork migration 158: move the fork-owned notification categories out of
-- upstream's number range. Upstream uses 15/16 (booking approval) and 100
-- (webhook disabled) in the same notifications.category column, so the fork's
-- TodoDeadline=15, MentionedInTask=16 ... OrderReminder=100 would be read as the
-- wrong kind of notification after an upstream merge.
--
-- Fork values get +1000: 15-19 -> 1015-1019, 100-107 -> 1100-1107
-- (see Elabftw\Enums\Notifications). Other categories are untouched.
--
-- Re-run safety: the old values (15-19, 100-107) and the new ones (1015-1019,
-- 1100-1107) do not overlap, so a second run finds no row to move and is a
-- no-op. It must NOT be replayed after upstream has created its own 15/16/100
-- rows; the custom_schema_migrations ledger guarantees it runs once. Migration
-- 041 (category 100 -> 18) ran earlier and is left as it is.
UPDATE `notifications`
    SET `category` = `category` + 1000
    WHERE `category` IN (15, 16, 17, 18, 19, 100, 101, 102, 103, 104, 105, 106, 107);

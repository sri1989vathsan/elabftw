-- Fork migration 064: let a team admin pin an announcement so it stays at
-- the top of the dashboard banner/feed and the history page, ahead of more
-- recent but less important ones.
ALTER TABLE `custom_announcements`
  ADD COLUMN `pinned` TINYINT(1) UNSIGNED NOT NULL DEFAULT 0 AFTER `severity`;

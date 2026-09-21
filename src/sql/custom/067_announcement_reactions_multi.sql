-- Fork migration 067: a reader can now pick more than one reaction on the
-- same announcement (e.g. both a thumbs-up and a heart) instead of only
-- one at a time -- the old unique-per-user constraint only allowed a
-- single row per (announcement, user); widen it to also include the emoji
-- itself, so one row per (announcement, user, emoji) instead.
ALTER TABLE `custom_announcement_reactions`
  DROP INDEX `uniq_custom_announcement_reactions_user`,
  ADD UNIQUE KEY `uniq_custom_announcement_reactions_user_emoji` (`announcement_id`, `userid`, `emoji`);

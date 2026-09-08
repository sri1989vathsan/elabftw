-- Fork migration 045: FULLTEXT indexes backing Orders search, replacing the
-- LIKE '%term%' scans on title/notes, comment bodies and extracted PDF text
-- (none of these can use an ordinary B-tree index for a substring match, so
-- each one becomes a full table/column scan as the tables grow).
-- Tradeoff, by design: FULLTEXT is word-based, not substring-based -- a
-- search now matches whole words (or word prefixes, via the '*' wildcard
-- applied in Orders::toFulltextQuery()) rather than any substring anywhere
-- in the text. Words shorter than innodb_ft_min_token_size (server default:
-- 3 characters) are not indexed and so cannot be found this way.
SET @custom_exists = (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_orders' AND INDEX_NAME = 'ft_custom_orders_title_notes'
);
SET @custom_sql = IF(@custom_exists = 0,
    'ALTER TABLE custom_orders ADD FULLTEXT INDEX ft_custom_orders_title_notes (title, notes)',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @custom_exists = (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_order_comments' AND INDEX_NAME = 'ft_custom_order_comments_body'
);
SET @custom_sql = IF(@custom_exists = 0,
    'ALTER TABLE custom_order_comments ADD FULLTEXT INDEX ft_custom_order_comments_body (body)',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @custom_exists = (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_order_uploads' AND INDEX_NAME = 'ft_custom_order_uploads_extracted_text'
);
SET @custom_sql = IF(@custom_exists = 0,
    'ALTER TABLE custom_order_uploads ADD FULLTEXT INDEX ft_custom_order_uploads_extracted_text (extracted_text)',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

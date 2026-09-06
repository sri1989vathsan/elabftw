-- Fork migration 038: extracted text layer for order attachments (PDFs for
-- now), so search can match content inside a receipt/quote, not just its
-- filename. Scanned/image-only PDFs have no text layer and stay unindexed
-- until OCR is added -- a deliberate limitation, not a bug.
SET @custom_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_order_uploads' AND COLUMN_NAME = 'extracted_text'
);
SET @custom_sql = IF(@custom_exists = 0,
    'ALTER TABLE custom_order_uploads ADD COLUMN extracted_text MEDIUMTEXT NULL AFTER filesize',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Fork migration 043: track PDF text extraction as an async background job
-- instead of running it synchronously inside the upload request (a large
-- PDF could make the upload slow or hit the request time/memory limit).
-- 'none' = not a PDF, nothing to extract. 'pending' = queued, not run yet.
-- 'done'/'failed' = ran; 'failed' covers encrypted/corrupted/unparseable
-- files (still uploaded successfully, just not searchable by content).
SET @custom_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'custom_order_uploads' AND COLUMN_NAME = 'extraction_status'
);
SET @custom_sql = IF(@custom_exists = 0,
    'ALTER TABLE custom_order_uploads ADD COLUMN extraction_status ENUM(\'none\', \'pending\', \'done\', \'failed\') NOT NULL DEFAULT \'none\' AFTER extracted_text',
    'SELECT 1');
PREPARE stmt FROM @custom_sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- backfill existing rows from before this column existed: they already went
-- through the old synchronous extraction, so there is nothing left pending
-- for them -- either it found text ('done') or it's not a pdf / found none
-- ('none', a soft default rather than 'failed' since we can't tell those
-- apart in hindsight)
UPDATE custom_order_uploads
SET extraction_status = 'done'
WHERE extraction_status = 'none' AND extracted_text IS NOT NULL;

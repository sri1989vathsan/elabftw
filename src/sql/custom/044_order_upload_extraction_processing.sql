-- Fork migration 044: add a 'processing' extraction_status so
-- OrderUploads::extractOne() can atomically claim an upload (UPDATE ...
-- WHERE extraction_status = 'pending') before doing the actual parsing.
-- Without this, two workers picking up the same 'pending' row at once
-- (e.g. the invoker-dispatched run racing a manual catch-up sweep) could
-- both extract the same PDF.
ALTER TABLE custom_order_uploads
    MODIFY COLUMN extraction_status ENUM('none', 'pending', 'processing', 'done', 'failed') NOT NULL DEFAULT 'none';

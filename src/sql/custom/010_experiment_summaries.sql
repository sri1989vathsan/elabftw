-- Fork migration 010: allow experiment goal and conclusion summaries up to 1000 characters.
--
-- Validation continues to limit folder and category descriptions to 500
-- characters. The wider column is used only by experiment summaries.
ALTER TABLE `custom_ui_descriptions`
  MODIFY `description` VARCHAR(1000) NOT NULL DEFAULT '';

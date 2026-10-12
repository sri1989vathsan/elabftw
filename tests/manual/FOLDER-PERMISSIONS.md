# Folder permissions: manual test list (build 66, 2026-10-12)

A folder can remember who may see and who may edit what is in it. Set from the folder's **Edit** dialog
(sidebar) > **Permissions** (folder owner and admins). Applies to experiments and resources.

Run the API checks from the browser console on `localhost:8973/experiments.php` (logged in); the dialog
checks are by hand.

| # | Check | Result |
|---|-------|--------|
| 1 | Permissions button appears in the Edit folder dialog for the owner / admin | PASS |
| 2 | A folder with nothing remembered starts the dialog from the account defaults (read: team, write: owner and admins) | PASS |
| 3 | Dialog shows the item count (experiments and resources, subfolders included), or "no items yet" | PASS |
| 4 | Apply replaces the permissions of every item in the folder and subfolders; the folder remembers them | PASS |
| 5 | Items outside the folder are untouched | PASS |
| 6 | Teams, user groups and specific users can be picked; stored; shown with names when the dialog is reopened | PASS (user groups: none exist in the test data) |
| 7 | Base level and the picks apply separately to "can see" and "can edit" | PASS |
| 8 | Include subfolders ticked: whole tree; unticked (also sent as the text "false"): only the folder's own items | PASS |
| 9 | Three-level tree: each folder remembers the permissions; deeper items follow | PASS |
| 10 | One experiment's permissions can still be changed by hand and the change sticks (folder unchanged) | PASS |
| 11 | Applying again replaces individually changed items | PASS (by design) |
| 12 | New experiment or resource created in the folder takes the folder's permissions | PASS |
| 13 | Duplicate of an item in the folder takes them | PASS |
| 14 | Item moved into a folder that remembers permissions takes them; into one that remembers none keeps its own; moved out to unfiled keeps its own | PASS |
| 15 | New subfolder starts with the parent's remembered permissions | PASS |
| 16 | Resources behave like experiments (apply, new, moved) | PASS |
| 17 | Archived items are left as they are and counted as skipped; trashed items are ignored | PASS |
| 18 | Invalid base, bad JSON, wrong shape, missing field, text instead of number, unknown folder: rejected (400/404), nothing stored | PASS |
| 19 | Unknown team / user group / user ids rejected, nothing stored or changed | PASS (build 66) |
| 20 | Moving a folder changes nothing; deleting a leaf folder keeps items' permissions; folder with subfolders cannot be deleted; no leftover rows | PASS |
| 21 | Declining the confirmation changes nothing and keeps the dialog open | PASS |
| 22 | 60 experiments applied in one go: all correct, about 1 second | PASS |
| 23 | Items with locked permissions skipped for non-admins (never half-updated) | NOT TESTED: the test account is a sysadmin, which overrides locks |
| 24 | Non-owner / non-admin does not see the button and the server refuses | NOT TESTED: no second non-admin login |
| 25 | Items owned by other users are skipped and counted | NOT TESTED: same reason |
| 26 | Permissions of a user deleted later are left out when applied to new items | NOT TESTED |

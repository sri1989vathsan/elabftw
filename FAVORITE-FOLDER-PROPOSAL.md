# Feature Proposal: Favorite Folder

## Summary

Adds a per-user "favorite folder" feature to the experiments folder sidebar. Users can star any folder (root-level or nested) to pin it to the top of the sidebar. All other root-level folders collapse by default, keeping the sidebar focused on the active project.

## Motivation

When a team accumulates many experiment folders, the sidebar becomes cluttered. Researchers typically work within one project folder at a time. This feature lets each user mark their current working folder so it's always immediately visible and expanded on page load, without affecting other users' views.

## How it works

- A small star icon appears next to each folder name in the sidebar
- Clicking the star sets that folder as the user's favorite (clicking again removes it)
- Only one favorite per user is supported
- On page load:
  - The favorite folder (or its root ancestor, for subfolders) is moved to the top of the sidebar
  - The full path from the root to the favorite is expanded
  - All other root-level folders are collapsed
  - Subfolders below the favorite are collapsed
- Folder icons toggle between closed (`fa-folder`) and open (`fa-folder-open`) based on collapsed/expanded state
- If the user navigates to a specific folder via URL, that folder's path is expanded regardless of favorite state

## Implementation

### Database

A single nullable column `favorite_experiment_folder` is added to the `users` table with a foreign key to `experiments_folders(id)` and `ON DELETE SET NULL`. This was chosen over a junction table because only one favorite per user is needed.

```sql
ALTER TABLE `users` ADD COLUMN `favorite_experiment_folder` INT UNSIGNED NULL DEFAULT NULL;
ALTER TABLE `users` ADD CONSTRAINT `fk_users_fav_exp_folder`
  FOREIGN KEY (`favorite_experiment_folder`) REFERENCES `experiments_folders`(`id`) ON DELETE SET NULL;
```

### Backend (PHP)

`ExperimentsFolders` model gets two new methods:

- `getFavoriteFolder(): ?int` — reads the current user's favorite from the `users` table
- `toggleFavorite(?int $folderId): void` — sets or unsets the favorite (toggle behavior)

The existing `patch()` method is extended to handle `{ action: 'toggle_favorite', folder_id: N }` in the request body, routing through the `experiments_folders` API endpoint without requiring a folder ID in the URL.

`AbstractEntityController` passes `favoriteFolderId` to both the `show()` and `edit()` template render arrays.

### Frontend (Twig template)

- The sidebar div gets a `data-favorite-folder-id` attribute with the server-provided value
- Each folder row gets a star icon (`far fa-star` / `fas fa-star`) with `data-action='toggle-favorite-folder'`
- The `favoriteFolderId` is passed through the recursive `renderFolderTree` macro so the correct star is filled
- All folder icons use a `.folder-icon` class for JS targeting, starting as `fa-folder` (JS swaps to `fa-folder-open` when expanded)

### Frontend (TypeScript)

- `on('toggle-favorite-folder', ...)` sends a PATCH request and reloads the page
- `getRootAncestorId()` and `getAncestorIds()` walk the DOM tree to support nested favorites
- `pinFavoriteToTop()` moves the root ancestor node to the top of the sidebar
- `applyDefaultCollapseForFavorite()` collapses all non-ancestor root folders, expands the path to the favorite, and collapses subfolders below the favorite
- `applyFolderState()` toggles caret direction, children visibility, and folder icon (`fa-folder` / `fa-folder-open`)

### Files changed

| File | Change |
|------|--------|
| `src/sql/schema208.sql` | Migration: add column + FK |
| `src/sql/schema208-down.sql` | Rollback migration |
| `src/sql/structure.sql` | Column added for fresh installs |
| `src/Elabftw/SchemaVersionChecker.php` | Bump `REQUIRED_SCHEMA` to 208 |
| `src/Models/ExperimentsFolders.php` | `getFavoriteFolder()`, `toggleFavorite()`, extended `patch()` |
| `src/Controllers/AbstractEntityController.php` | Pass `favoriteFolderId` to templates |
| `src/templates/experiments-folders.html` | Star icon, `data-favorite-folder-id`, `.folder-icon` class |
| `src/ts/experiments-folders.ts` | Favorite toggle, pin-to-top, default collapse, icon swap |

## Compatibility

- No breaking changes to existing functionality
- The `favorite_experiment_folder` column defaults to `NULL` (no favorite), so existing users are unaffected
- The FK uses `ON DELETE SET NULL`, so deleting a folder gracefully clears any user's favorite pointing to it
- Collapse state is stored in localStorage per browser, so the favorite default collapse only applies when no prior state exists or when no specific folder is selected in the URL

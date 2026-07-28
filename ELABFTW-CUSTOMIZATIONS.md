# eLabFTW Fork Customizations

This document tracks all custom features added to this fork, to help with future merges against upstream.

## Feature 1: Experiment Folders

Hierarchical folder structure for organizing experiments.

**Files modified:**
- `src/sql/schema207.sql` — `CREATE TABLE experiments_folders` (made idempotent with `IF NOT EXISTS`)
- `src/ts/experiments-folders.ts` — Collapsible folder tree with localStorage persistence, uses `on()` handler delegation
- `src/templates/experiments-folders.html` — Toggle carets, `.folder-node`, `.folder-toggle`, `.folder-children` elements
- `src/templates/experiments-folder-select.html` — Changed to show `folder.full_path` instead of just `folder.name`

## Feature 2: Lab Logs and Owner Names

Monthly lab logs with owner names and dashboard.

**Files modified:**
- Various log-related templates and TypeScript files (committed in early branch commits)

## Feature 3: Searchable, Linkable Table of Contents

A SidePanel TOC that extracts every header and subheader from `#body_view`
(view mode) or the TinyMCE editor (edit mode). It provides heading search,
scroll-spy, and smooth scrolling. In view mode, a TOC search also filters the
main text to the matching heading sections and keeps parent headings visible for
context; clearing the query restores the complete text. The filtering uses
transient display classes and never changes the saved body. Each entry has a
link button that copies a stable view-mode URL to that exact section. Edit mode
also shows an insert button that adds the internal section link at the current
editor cursor. Generated heading IDs are saved with the body and retained by
the sanitizer.

**Files added:**
- `src/ts/TocPanel.class.ts` — SidePanel subclass with heading extraction, scroll-spy via IntersectionObserver, smooth scrolling
- `src/templates/toc-panel.html` — Panel HTML template

**Files modified:**
- `src/ts/common.ts` — TocPanel import/instance, toggle-sidepanel handler routes `toc` target, refresh-toc handler
- `src/ts/FavTag.class.ts` — Added TocPanel import and mutual exclusion in toggle()
- `src/ts/Todolist.class.ts` — Added TocPanel import and mutual exclusion in toggle()
- `src/templates/head.html` — Added TOC opener button
- `src/scss/main.scss` — TOC panel styles (`.toc-items-container`, `.toc-highlight`, `@keyframes toc-flash`)

**Note:** The TinyMCE plugin's built-in TOC sidebar was removed. The custom
SidePanel works in both view and edit modes.

## Feature 4: Collapsible Folder Tree

Makes the experiment folder sidebar collapsible with persistent open/closed state stored in localStorage.

**Files modified:**
- `src/ts/experiments-folders.ts` — Added `on('toggle-folder-children', ...)` using eLabFTW's global event delegation system (`on()` from `./handlers.ts`)
- `src/templates/experiments-folders.html` — Added toggle carets, `.folder-node`, `.folder-toggle`, `.folder-children` elements

**Important pattern:** Direct `addEventListener` on `[data-action]` elements does NOT work in eLabFTW because the global `#container` click listener intercepts all `[data-action]` clicks. Must use `on(action, fn)` from `./handlers.ts`.

## Feature 5: Full Path in Folder Dropdown

Shows the full folder path (e.g., `Lab > Project A > Sub-experiment`) in the experiment edit dropdown instead of just the folder name.

**Files modified:**
- `src/templates/experiments-folder-select.html` — Changed from `folder.name` to `folder.full_path`

## Feature 6: Inline Spreadsheets

Embeds small spreadsheet grids with formula support (SUM, AVERAGE, COUNT, MIN, MAX, IF, ROUND, ABS, CONCATENATE) directly in experiment/resource body text. Uses jspreadsheet-ce v5 (already a project dependency).

Data is stored as base64-encoded JSON in a `data-spreadsheet` attribute on the `<table>` element. The table cells show computed formula results so the document looks correct even without JavaScript. Double-clicking a spreadsheet table in the editor reopens it for editing.

**Files added:**
- `src/ts/inline-spreadsheet.ts` — Core module: encode/decode spreadsheet data, plain overlay editor (not Bootstrap modal — Bootstrap's `enforceFocus` breaks jspreadsheet formula range selection), DOM-based formula evaluation, HTML table generation with column/row headers, formula helper bar

**Files modified:**
- `src/ts/tinymce.ts` — Added `inline-sheet` toolbar button, import of inline-spreadsheet module, double-click handler for spreadsheet tables, bookmark/restore TinyMCE selection around modal, removed in-editor TOC sidebar (toc-nav, toc-sidebar), removed unused `escapeHTML` import
- `src/Services/Filter.php` — Added `class` and `data-spreadsheet` to allowed `<table>` attributes, added `data-spreadsheet` as `Text` attribute, added `elabftw-spreadsheet` to AllowedClasses
- `src/scss/main.scss` — Inline spreadsheet styles (`.inline-spreadsheet-container`, `table.elabftw-spreadsheet` with zebra rows and hover outline, `.jss_container` z-index for overlay)
- `src/templates/base.html` — Removed Bootstrap modal template (replaced by JS-created overlay)

**Key technical decisions:**
- Uses a plain JS overlay instead of Bootstrap modal because Bootstrap's `enforceFocus` breaks jspreadsheet's cell selection and formula range picker
- Reads computed formula values from the rendered DOM cells (`.jss_worksheet tbody td`) rather than via the v5 API (`getValueFromCoords` returns raw formula text)
- v5 API requires `worksheets: [{ data, minDimensions }]` config (not root-level `data`)
- v5 `getData()` takes no arguments (unlike v4)
- Instance access: `instance[0]` gives the first worksheet
- `selectionCopy: true` enables the drag-to-fill corner handle

## Feature 7: Favorite Folder

Per-user favorite folder that is pinned to the top of the sidebar and auto-expanded, while all other root folders are collapsed by default.

**Files added:**
- `src/sql/schema208.sql` — Adds `favorite_experiment_folder` column to `users` table with FK to `experiments_folders`
- `src/sql/schema208-down.sql` — Rollback migration

**Files modified:**
- `src/Elabftw/SchemaVersionChecker.php` — Bumped `REQUIRED_SCHEMA` from 207 to 208
- `src/Models/ExperimentsFolders.php` — Added `getFavoriteFolder()` and `toggleFavorite()` methods, extended `patch()` to handle `action: 'toggle_favorite'`
- `src/Controllers/AbstractEntityController.php` — Pass `favoriteFolderId` to template render arrays (both `show()` and `edit()`)
- `src/templates/experiments-folders.html` — Added `data-favorite-folder-id` attribute on sidebar, star icon (`fa-star`) per folder, passed `favoriteFolderId` through recursive macro
- `src/ts/experiments-folders.ts` — Added `toggle-favorite-folder` action handler via `on()`, `pinFavoriteToTop()` DOM reordering, `applyDefaultCollapseForFavorite()` to collapse non-favorite root folders

**Key technical decisions:**
- Uses a column on the `users` table (not a junction table) because only one favorite per user is supported
- Star toggle uses PATCH to `experiments_folders` endpoint with `{ action: 'toggle_favorite', folder_id: N }` in request body
- Favorite folder's root ancestor is moved to top of DOM on page load before collapse state is applied
- Works with both root-level and nested subfolder favorites: for subfolders, the entire ancestor chain is expanded while the containing root folder is pinned to the top
- Subfolders below the favorite are collapsed by default
- Folder icons toggle between `fa-folder` (closed) and `fa-folder-open` (expanded) based on collapse state, using a `.folder-icon` CSS class on the icon element for JS targeting

## Feature 8: Folder Selection in Create Modal

Adds a folder dropdown and inline folder creation to the experiment creation modal, so users can assign experiments to folders at creation time.

**Files modified:**
- `src/templates/create-new-modal.html` — Added folder select dropdown (`createNewFolderSelect`) with full_path options, "New folder" button with inline creation UI
- `src/ts/create-new.ts` — `setTypeRadio()` shows/hides folder section based on entity type; inline folder creation via `ApiC.post('experiments_folders', ...)` with ID extraction from Location header
- `src/Models/AbstractEntity.php` — After `create()`, checks for `folder_id` in request body and assigns experiment to folder via `ExperimentsFolders::assignExperiment()`

**Key technical decisions:**
- Uses `collectForm()` auto-collection of `name='folder_id'` select value
- Folder assignment happens post-creation (not by modifying `create()` method signature)
- Folder section only visible when entity type is `experiments`

## Feature 9: "Other Folders" Collapsible Group

Wraps non-favorite root-level folders into a collapsible "Other folders" group in the sidebar.

**Files modified:**
- `src/ts/experiments-folders.ts` — Added `wrapOtherFolders()` function that creates a DOM wrapper with localStorage persistence for collapse state

## Feature 10: LabCollector LIMS Quick-Link Helper

Adds a UI widget on the experiment edit page for quickly linking to entities in LabCollector LIMS. Supports two modes: adding as a URL-type extra field, or inserting a clickable link directly into the editor body.

**URL pattern:** `http://bs-labcollect01.ethz.ch/moor/{type}.php?search=1&strict=on&by_id={id}`

**Entity types:** Plasmid, Strain, Chemical, Sample, Antibody, Storage

**Files modified:**
- `src/templates/edit.html` — Added LabCollector helper section (experiments only) with entity type dropdown, ID input, "Add as field" and "Insert in text" buttons
- `src/ts/edit.ts` — Added `add-labcollector-link` handler (reads metadata, adds URL extra field, patches back) and `insert-labcollector-link` handler (inserts hyperlink at cursor via `editor.setContent()`, supports both TinyMCE and markdown)

**Key technical decisions:**
- "Add as field" stores the link as a `url`-type extra field in experiment metadata JSON — no schema migration needed, works with existing search/filtering, renders as clickable link in view mode
- "Insert in text" uses the existing `editor.setContent()` pattern to insert at cursor position
- Page reloads after adding as field to re-render the metadata div (since the Metadata class instance isn't accessible from edit.ts)

## Feature 11: Floating Sidebar Navigation Tabs

Moves the experiment folder tree out of the listing body and into its own left
sidebar tab alongside Table of Contents, Favorite Filters, and Todolist. The
compact tab rail is fixed to the viewport, so it remains available while a long
experiment or listing page scrolls. The rail itself stays in one position when a
panel opens, avoiding horizontal jumps and bounce animations. Opening a tab
closes the previous panel and the last open tab is restored from localStorage.

The folder tab retains the existing hierarchy, favorite-folder pinning,
create/rename/delete controls, and persisted expand/collapse state.

## Feature 12: Combined Favorite Filters

Adds server-backed per-user favorites for experiment/resource categories,
statuses, owners, and tags in one left sidebar tab. Category, tag, status, and
owner filters can be combined; statuses support multiple choices and owner
matches eLabFTW's single-owner filtering. The panel can target experiments or
resources and restores selections from the URL. Applying filters always opens
the complete accessible listing (`scope=3`) so results are not silently
restricted by a previous "My experiments", search, or pagination selection.
Each filter group is independently collapsible and keeps its current selections
when closed.

The Manage favorites section can create a new category for the currently
selected target and immediately favorite it, or favorite existing categories,
owners, statuses, and tags.

**Files added:**
- `src/Models/FavCategories.php`
- `src/Models/FavFilters.php`
- `src/templates/favorite-filters-panel.html`
- `src/ts/FavoriteFilters.class.ts`
- `src/sql/schema210.sql` and `src/sql/schema210-down.sql`
- `src/sql/schema211.sql` and `src/sql/schema211-down.sql`

## Feature 13: Spreadsheet Presets and Table Formatting

Extends inline spreadsheets with custom dimensions (up to 50 × 50),
Benchling-style named data tables, 6/12/24/48/96/384-well plate presets, captions
above tables, and a visual aggregate formula builder. Select a source range and
click SUM, AVERAGE, COUNT, MIN, or MAX; the result formula is placed immediately
below the selection. Tables can be indented/outdented in 2.5rem steps to align
with nested bullets, and the sanitizer preserves TinyMCE's nested-list marker so
Tab indentation does not render duplicate bullets.

The TinyMCE toolbar now shows a labeled **Spreadsheet** menu. Its entries expose
Custom size, Benchling-style data table, and a Well plate submenu with every
supported preset, so the layouts are visible before opening the spreadsheet
editor.

The main-text editor also enables focused Markdown-style list shortcuts without
enabling TinyMCE's heading shortcuts: type `-` followed by Space for a bulleted
list, or `1.` followed by Space for a numbered list.

Spreadsheet updates preserve TinyMCE table formatting instead of rebuilding an
unformatted grid. Table borders and layout, caption formatting, and per-cell
border, background, text, alignment, padding, and sizing styles round-trip
through the embedded spreadsheet data and are restored after formula edits.

## Schema Migration Notes

- `schema207.sql` — Combined: experiment folders table + folder_id column (our additions) and booking cost columns (upstream). Uses `CREATE TABLE IF NOT EXISTS` and conditional `ALTER TABLE` for idempotent re-runs
- `schema208.sql` — Upstream: adds `force_res_tpl` column to `teams` table
- `schema209.sql` — Our addition (renumbered from 208 after upstream merge): adds `favorite_experiment_folder` column to `users` table with FK to `experiments_folders(id)` with `ON DELETE SET NULL`
- `schema210.sql` — Adds server-backed favorite experiment/resource categories
- `schema211.sql` — Adds server-backed favorite owner/status filters

## General Merge Notes

- eLabFTW uses Yarn PnP (no `node_modules` directory) — packages are in zip archives
- Build: `docker exec elabftw bash -c 'NODE_OPTIONS="--max-old-space-size=4096" yarn buildall'`
- Dev rebuild: `docker exec elabftw bash -c 'NODE_OPTIONS="--max-old-space-size=4096" yarn build:dev --watch'`
- Global event delegation: all `[data-action]` clicks are intercepted by `#container` listener in `src/ts/common.ts` — use `on(action, fn)` from `src/ts/handlers.ts`, not direct `addEventListener`
- HTMLPurifier config in `src/Services/Filter.php` must whitelist any new HTML attributes/classes

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
(view mode) or the TinyMCE editor (edit mode). It provides multi-filter heading
search, scroll-spy, and smooth scrolling. Search terms can be committed as
removable chips and combined using **All filters** or **Any filter**. In view
mode, the same filters subset the main text to matching heading sections and
keep parent headings visible for context; clearing the filters restores the
complete text. Filtering uses transient display classes and never changes the
saved body. Each entry has a
link button that copies a stable view-mode URL to that exact section. Edit mode
also shows an insert button that adds the internal section link at the current
editor cursor. If text is selected, the button preserves that label and only
adds the section link; without a selection it inserts the heading title as the
linked label. Generated heading IDs are saved with the body and retained by the
sanitizer.

The TOC also exposes a searchable hierarchical section picker. Heading options
show their complete parent path, so an H3 is found when a search term matches
its H1, H2, or its own label. Parent checkboxes select their whole subtree, and
partially selected parents use the native indeterminate state. The tree is
expandable, duplicate heading names remain distinguishable by path, and compact
chips represent selected branches. Multiple section selections are combined as
a union; text filters refine that union while retained parent headings provide
document context.

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

TinyMCE's **Link** toolbar control also exposes **LabCollector link…** beside
the normal web/file link dialog. It reuses the helper's type and ID choices,
restores the editor selection after the dialog closes, and applies the generated
LabCollector URL directly to selected text. With no selection it inserts the
usual descriptive LabCollector label.

**URL pattern:** `http://bs-labcollect01.ethz.ch/moor/{type}.php?search=1&strict=on&by_id={id}`

**Entity types:** Plasmid, Strain, Chemical, Sample, Antibody, Storage

**Files modified:**
- `src/templates/edit.html` — Added LabCollector helper section (experiments only) with entity type dropdown, ID input, "Add as field" and "Insert in text" buttons
- `src/ts/edit.ts` — Added `add-labcollector-link` handler (reads metadata, adds URL extra field, patches back) and `insert-labcollector-link` handler (inserts hyperlink at cursor via `editor.setContent()`, supports both TinyMCE and markdown)
- `src/ts/labcollector-link.ts` — Validates supported entity types/positive IDs and builds the shared URL used by both entry points
- `src/ts/tinymce.ts` — Adds the combined Link menu and selection-preserving LabCollector dialog

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
owners, statuses, and tags. Applying or clearing the filters refreshes matching
experiments or resources directly inside the sidebar, while **Full list** opens
the same combination in the normal listing. Each result title links to the
entry heading. Results use the filter panel's theme colours and a compact row
layout. While an experiment is being edited, the clearly labelled **Link**
button beside a result only creates the appropriate experiment/resource
relationship in the notebook Links section. A separate **Add to text** action
only inserts the permanent entry link in the main text, without creating a
notebook relationship. It remains available after insertion, so the link can be
added at multiple cursor positions. Opening a different result from edit mode
first warns about potentially unsaved changes.

Adding or removing a category, owner, or status favorite refreshes only that
part of the open panel instead of reloading the page. The active sidebar tab,
scroll position, target type, and checked filter choices therefore remain in
place while favorites are managed.

The favorite-tag field searches existing team tags
as the user types, keeps its suggestion menu above the sidebar, excludes tags
that are already favorites, and supports mouse or keyboard selection. Favorite
tag choices are stored per account through eLabFTW's `favtags2users` mapping;
the underlying experiment tags remain team-shared. Autocomplete initialization
is idempotent and the sidebar observer reacts only when a genuine tag input is
inserted, preventing the suggestion menu from recursively triggering itself.

All left sidebar tabs share an adjustable width. Drag the narrow separator on
the panel's right edge, or focus it and use the Left/Right arrow keys, to resize
Folders, Table of Contents, Filters, and the todo panel together. The chosen
width is stored in the browser and restored on the next visit, with viewport
limits that keep the main document usable.

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
above tables, and a visual formula builder. Select a source range and click SUM,
AVERAGE, COUNT, MIN, MAX, addition, subtraction, multiplication, or division; the
result formula is placed immediately below the selection. Standard arithmetic
formulas such as `=A1+B1`, `=A1-B1`, `=A1*B1`, `=A1/B1`, and expressions with
parentheses can also be typed directly. Tables can be indented/outdented in 2.5rem steps to align
with nested bullets. Indentation is applied to a structural wrapper rather than
rewriting the table's width or alignment, so full-width, centered, well-plate,
and formula tables remain stable. Multi-cell selections and toolbar focus retain
the active table correctly. The sanitizer also preserves TinyMCE's nested-list
marker so Tab indentation does not render duplicate bullets.

The TinyMCE toolbar now shows a labeled **Spreadsheet** menu. Its entries expose
Custom size, Benchling-style data table, and a Well plate submenu with every
supported preset, so the layouts are visible before opening the spreadsheet
editor.

The main-text editor also enables explicit list shortcuts without enabling
TinyMCE's other heading/format text patterns: at the beginning of an otherwise
empty paragraph, type `-` followed by Space for a bulleted list, or `1` (also
`1.`) followed by Space for a numbered list. A dedicated **Checklist** toolbar
button creates checkable protocol/task lists; `[ ]` followed by Space starts an
unchecked list and `[x]` followed by Space starts one with the first item
checked. Clicking the square marker while editing toggles an item, and the
checked state survives save, view mode, printing, and reopening. Tables, code
blocks, and existing list items are excluded from the typing shortcuts, and
each conversion is a single undo step.

In the editor, Tab and Shift+Tab explicitly indent and outdent the current list
item, paragraph, heading, quote, or other editable block instead of moving focus
to the next editor control. Table cells retain TinyMCE's native Tab navigation.
The handler runs during the editor iframe's capture phase, with an editor-event
fallback, so TinyMCE and browser focus navigation cannot consume the key first.
Numbered lists change markers with the hierarchy: decimal numbers at the first
level, lower-case letters after one Tab, and lower-case Roman numerals after a
second Tab. Deeper levels repeat that cycle, while Shift+Tab restores the
corresponding outer marker.
The entity action toolbar is sticky in both view and edit mode, keeping Back and
Edit/View available while scrolling. In edit mode, the existing Save and
Save-and-back actions live in that sticky toolbar, with TinyMCE's own sticky
toolbar offset beneath it.

Spreadsheet updates preserve TinyMCE table formatting instead of rebuilding an
unformatted grid. Table borders and layout, caption formatting, and per-cell
border, background, text, alignment, padding, and sizing styles round-trip
through the embedded spreadsheet data and are restored after formula edits.

The spreadsheet editor also exposes appearance defaults for table width,
alignment, border width/style/color, background, cell spacing/padding, cell
border width/color, base cell color, and optional alternating row and column
colors. The current table previews changes immediately. Font settings are
available in the same collapsed appearance panel, and **Save everything as
default** persists the complete table, cell, and font combination either on the user's account
or on the current experiment/resource (including template entities); a notebook
default takes precedence over the account default, while direct formatting on
an individual table or cell takes precedence over both. The combined
**Table and cell appearance** section starts collapsed so the editor opens with
more space for the spreadsheet grid. The lower cell/font toolbar only formats
the current selection and uses a compact, always-visible layout. A selected cell range
can also be formatted directly with quick controls for background color, border
color, border style, and border width, or returned to inherited defaults with
**Clear format**. Schema 212 stores the scoped settings as validated JSON.

Spreadsheet range selection is retained while the user interacts with color,
border, and formula controls. The selected range is restored after a preview
remount and the status line names the exact A1-style range and cell count, so
multi-cell property changes consistently apply to the intended cells.
The jspreadsheet v5 worksheet is captured after its asynchronous load finishes,
which keeps range formulas and formatting connected to the active grid.
The popup also rechecks the mounted worksheet after initialization and uses a
bounded hydration retry until both the expected rows and a representative saved
value are observable. This restores raw values and formulas when jspreadsheet
temporarily renders only its headers or blank minimum-dimension rows;
worksheet-only options are passed at the v5 worksheet level.
Excel-style formula picking is also supported: select a result cell, type a
formula prefix such as `=SUM(`, then drag across cells, whole columns, or whole
rows. The A1 range is inserted without closing the cell editor, and Enter
automatically closes missing parentheses, explicitly commits the formula to the
worksheet, and recalculates the cell.
Typing `=` by itself also enables cell picking for arithmetic formulas. Click a
cell to insert its A1 reference, type `+`, `-`, `*`, or `/`, and click the next
cell; the editor remains active until Enter applies the completed formula.
The aggregate functions and arithmetic operations exposed in the formula bar
also have a deterministic display fallback. Raw
formulas remain stored in spreadsheet metadata, while their results are
rendered after Enter, formula-button insertion, and spreadsheet reopening even
if jspreadsheet does not refresh the visible cell text.
The popup keeps those raw formulas in an independent data mirror because
jspreadsheet v5 can replace them in `getData()` with a computed value, an empty
cell, or `#ERROR`. Edition-end and delayed repaint hooks render the deterministic
aggregate result even when jspreadsheet leaves its `editor` class on a closed
cell. The same fallback is applied while generating the main-text table, so
reopening, calculating, and saving no longer overwrite one another.
Jspreadsheet's own formula execution is disabled for the popup. The grid keeps
the raw formula as ordinary cell data and the inline spreadsheet evaluator is
the single calculation path; this prevents a saved formula from aborting the
v5 worksheet hydration while its rows are being restored.
When a whole row or column selection would contain the result cell, the picker
uses the adjacent source cells instead of creating a circular reference and
showing `#ERROR`.
Structured clipboard data can be pasted directly into the main editor and is
inserted as an editable, formula-enabled spreadsheet with column letters and
row numbers. Excel and LibreOffice HTML retains sanitized cell backgrounds,
text colors, fonts, emphasis, alignment, borders, dimensions, and padding.
Plain-text detection supports CSV, TSV, semicolon- and pipe-delimited tables,
Markdown tables, and PDF-extracted columns separated by tabs or repeated
spaces. Detection requires a consistent multi-column structure so ordinary
prose continues through TinyMCE's normal paste path. Native paste inside the
spreadsheet popup remains available for filling the currently selected range.
Each generated table stores the values last rendered in the main editor. When
a cell or caption is typed into directly outside the popup, reopening the
spreadsheet merges that visible edit back into its raw grid while preserving
unchanged formulas rather than replacing them with their displayed results.
Older embedded spreadsheets without this snapshot still synchronize ordinary
cells and retain their saved formulas.
The popup also applies font family, point size, bold, italic, underline, text
color, horizontal alignment, and vertical alignment to that retained range.
Only font controls changed by the user are applied, so unrelated cell styles
remain intact. Explicit **No fill** and **No text color** choices remove those
inline styles from the selected cells and return them to inherited
account/notebook defaults. A separate **Save cell style as default** control
stores the quick fill, border, font, text-color, and alignment settings for
either **This notebook** or **My account**. Notebook cell defaults override
account cell defaults, and direct selected-cell formatting continues to win.

The main editor toolbar also provides visible **Table style** and **Cell style**
shortcuts whenever the cursor is inside a table. Table style opens TinyMCE's
table-properties dialog for table dimensions, alignment, border, background,
spacing, padding, and caption. Cell style provides background color, border
color, border style, and border width for the selected cells. Those direct
styles are retained when a formula spreadsheet is reopened and updated.

Visible brush and crossed-brush shortcuts for **Format painter** and **Clear
formatting** are also included beside the text color controls. Format painter
captures the source text's font, size, emphasis,
foreground/background colors, decoration, spacing, and vertical alignment;
after selecting target text, clicking the brush again applies the captured
style as one undoable edit. Escape cancels a pending paint operation. Clear
formatting uses TinyMCE's remove-format command on the current selection.

## Feature 14: Integrated Task and Deadline Calendar

The existing To-do sidebar now contains two coordinated views without adding
another floating sidebar button. **Tasks and steps** combines personal tasks and
unfinished experiment/resource steps into one hierarchy sorted by deadline:
Overdue, Today, Tomorrow, each later calendar date, and No due date. Entries
within a group are ordered by exact time, and the User/Team switch applies to
the step entries without separating them from personal tasks. **Calendar** adds
scheduled personal tasks to a month grid and deadline agenda, alongside
unfinished experiment/resource steps that already have deadlines. A scheduled
personal task is therefore visible in both views and is completed from either
one. The calendar uses a compact planner layout with a prominent month header,
theme-aware day cards, distinct Today/Selected/Overdue states, event-count
pills, a small legend, and source-labeled agenda cards.

Scheduled tasks support a title, notes, an exact local date and time, and reminder
lead times at the deadline, 15 minutes, one hour, one day, one week, or a custom
number of minutes. Deadlines are normalized to UTC in storage and rendered in
the user's local browser timezone. Approaching and overdue work is shown on the
floating To-do badge, in the agenda, and as an in-page reminder. The existing
eLabFTW notification/email preference for step deadlines also controls scheduled
task reminders, so reminders are delivered through the normal header and email
notification paths without a separate preference. The floating To-do badge and
Calendar-tab badge count only incomplete entries that are overdue or due within
the next hour; configured reminder lead times remain independent.

The calendar respects the existing User/Team scope for experiment and resource
steps, supports day and month navigation, and links each step back to its source
entity. Completing a step in the calendar uses the same step workflow as the
experiment page and existing To-do list.

The same panel can create a private, account-specific iCalendar subscription
URL. It includes that user's scheduled personal tasks and owned
experiment/resource step deadlines, including reminder alarms. The URL can be
subscribed to from Google Calendar or Apple Calendar, regenerated if it is
exposed, and revoked at any time. Only a SHA-256 digest is stored by eLabFTW;
the bearer token is returned once. A publicly reachable trusted HTTPS URL is
required for Google or another cloud provider to fetch the feed; the localhost
demo instead exposes a **Preview .ics** action. This is a read-only
subscription, while Apple Reminders would require a separate native EventKit or
Shortcuts integration.

## Feature 15: Account-wide Colour Themes and Stable Action Layering

Settings > General > Display provides coordinated Classic, Ocean, Forest, Plum,
Sunset, Slate, Rose, and Amber combinations. The validated selection is saved
on the user account and changes page and editor surfaces, panels, forms, tables,
navigation, links, and action controls across eLabFTW. Every palette supplies
both light and dark variants.

The main navigation establishes a stacking layer above the sticky entity action
toolbar. Dropdowns such as **Experiments** therefore open over the floating
Back/Edit/Save bar instead of being obscured by it.
The navigation itself remains at the top of the viewport while scrolling.
Its live height is exposed as a CSS offset, including when the mobile menu is
expanded, so the sticky entity action toolbar remains directly underneath
rather than overlapping Experiments, Resources, or their dropdown menus.
The Create experiment/resource modal is rendered outside the sticky navigation
stacking context. Floating sidebar panels, tabs, and their resize handle remain
below Bootstrap's modal backdrop, so opening Create correctly moves focus into
the dialog and prevents the sidebar icons from intercepting clicks.

## Feature 16: Calendar Dates and Experiment References

The editor's split **Date** toolbar control retains plain timestamp insertion.
Clicking its main section inserts today's date immediately using saved defaults;
its arrow opens the full menu and native calendar picker. Calendar dates are
saved as accessible `<time>` elements with stable anchor IDs and a clearly
styled date link.
The calendar badge is generated from the selected date itself (localized month
plus day number), so it never shows a hard-coded day that disagrees with the
date label. Its month/day are visual-only icon content rather than selectable
text, so copying the link or selecting it includes only the chosen date label.
Opening an older linked date in the editor upgrades its badge to this format.

The calendar dialog includes a live display-format selector. It covers the
account's localized format, ISO `2026-07-29`, compact `20260729`, day-first and
month-first numeric forms with dashes or slashes, abbreviated and full month
names in both orders, weekday variants, month/year, and a free custom label.
The underlying semantic `datetime` remains ISO even when the visible label is
custom. **Save as default** stores the chosen format, custom label, heading
toggle, and H1-H6 level for later one-click insertions in that browser.

The same dialog can make the date a Heading 1 through Heading 6 instead of
inline text. Heading dates use the same stable anchor and experiment target,
appear in the hierarchy-aware Table of Contents, and can later be edited back
to an inline date or a different heading level.

By default, a date links back to its exact passage in the current entry. The
calendar dialog can instead search experiments and make the visible date open
the selected experiment. Placing the cursor on an inserted date exposes actions
to edit its date/experiment target or copy its permanent inbound link, allowing
another experiment to reference that exact dated passage. The semantic element,
anchor, link metadata, and date-reference class are retained by the server HTML
sanitizer across save and reopen.

The adjacent split **Title** control inserts the current experiment title as an
H1-H6 heading with a stable anchor, so it immediately participates in the Table
of Contents and its per-heading link action. The control's menu opens an
editable heading-text field plus font options for family, point size,
theme/custom text colour, optional background colour (including no background),
background coverage across the full title width or behind the text only, bold,
italic, underline, and alignment. **Save as default** retains the formatting
choices—but not document-specific heading text—in the browser, while the main
control and **Ctrl+Alt+T** insert the latest experiment title using the saved
settings. The same dialog can store up to 20 named title styles, load them into
the controls, update an existing style by reusing its name, or remove styles.

The adjacent **Line** toolbar menu inserts single or double horizontal rules in
either solid or dashed form. The solid actions are also available as
Ctrl+Shift+H and Ctrl+Alt+Shift+H while the editor has focus. All four rule
styles are retained through sanitization, view mode, and later edits. Both
double variants are rendered as two distinct one-pixel strokes with a small
gap.

## Schema Migration Notes

- `schema207.sql` — Combined: experiment folders table + folder_id column (our additions) and booking cost columns (upstream). Uses `CREATE TABLE IF NOT EXISTS` and conditional `ALTER TABLE` for idempotent re-runs
- `schema208.sql` — Upstream: adds `force_res_tpl` column to `teams` table
- `schema209.sql` — Our addition (renumbered from 208 after upstream merge): adds `favorite_experiment_folder` column to `users` table with FK to `experiments_folders(id)` with `ON DELETE SET NULL`
- `schema210.sql` — Adds server-backed favorite experiment/resource categories
- `schema211.sql` — Adds server-backed favorite owner/status filters
- `schema212.sql` — Adds account- and notebook-scoped spreadsheet appearance defaults
- `schema213.sql` — Adds notes, exact deadlines, reminder lead times, and a
  deadline index to personal to-do items
- `schema214.sql` — Adds one private external-calendar token per account and the
  validated account-wide colour-theme setting

## Feature: What's new page

A page listing the newest features, linked from the Tools menu. Sysadmins can edit
entries, add new ones and attach pictures from the page itself; team admins and
everyone else only read it.

- `src/whats-new.json` — the entries shipped with the code (id, date, area, title, summary, details, optional `image`, `imageAlt` and `highlight` {x, y, w, h as % of the picture, label} outlining where the feature is)
- `web/assets/images/whats-new/` — the pictures shipped with the code
- `src/Services/WhatsNewStore.php` — merges the shipped entries with what admins changed. Changes live in the persistent uploads volume (`/var/lib/elabftw/uploads/whats-new/`: `entries.json` and `images/`), so they survive upgrades. An edited entry replaces the shipped one with the same id, a deleted shipped entry stays hidden, and entries shipped later still appear.
- `src/Controllers/WhatsNewController.php`, `web/whats-new.php`, `src/templates/whats-new.html`, `src/templates/whats-new-form.html` — the page, its pictures (`whats-new.php?image=<name>`) and the admin forms (plain POST forms with the usual CSRF field, no script needed)
- `src/templates/head.html` — "What's new" item in the Tools dropdown
- `docker-compose.yml` — mounts for `web/whats-new.php` and, for quick edits during development, the data file, the template and the pictures folder
- `whats-new-screenshots/` — `process.py` turns screenshots dropped in `inbox/` into pictures (crop, blank out private areas, outline); see its README

## MoorLab Wiki, ETHIS and MoorLab Zoom links

Three more editable links under **Links** in the top bar, next to LabCollector and OpenIRIS:
MoorLab Wiki (`moorlab_wiki_url`), ETHIS (`ethis_url`, `https://ethis.ethz.ch`) and MoorLab Zoom
(`moorlab_zoom_url`). Each is stored per team and team admins edit it with the pencil next to it.

- `src/sql/custom/079_moorlab_wiki_link.sql`, `080_ethis_link.sql`, `081_moorlab_zoom_link.sql` — add the `teams` columns with their default URLs, registered in `CustomMigrationRunner`
- `src/Params/TeamParam.php` — validates them as optional URLs
- `src/templates/head.html` — the three entries are generated from one list (`editableLinks`), so adding another is one line plus a column and a validator entry
- `src/ts/common.ts` — the shared `edit-team-link` action

## Spreadsheets in the table of contents

Each spreadsheet is listed in the table of contents under the heading it sits in,
with its title (the table caption) or "Table N" when it has none. In the editor the
spreadsheet toolbar has an **Edit title** button that changes the caption in place.

- `src/ts/toc-tables.ts` — what counts as a listed spreadsheet and how its label is chosen
- `src/ts/TocPanel.class.ts` — spreadsheets are `kind: 'table'` entries: leaves, not filterable sections; a search can match their title
- `src/ts/custom-editor/TocExtension.ts` — refreshes the contents when a spreadsheet is added, removed or retitled
- `src/ts/inline-spreadsheet.ts` — the Edit title button; the table id is kept across view-mode swaps
- `src/ts/custom-editor/SpreadsheetExtension.ts` — keeps the table's `id` when an edit rewrites its attributes

## Project canvas (Boards)

A free-form canvas next to the column board. A card is a question, a pointer to an existing to-do task, or a pointer to an experiment; arrows connect cards. The canvas toggle (diagram icon) sits in the Boards toolbar and is remembered per browser.

- Each project (and subproject) keeps its own coordinate space. The canvas shows a project with a tree on the left; ticking several subprojects shows them side by side in labelled frames, offset only on screen (the offset is never saved).
- Task and experiment cards show live data (assignees, deadline, steps, comments, column; experiment status). A click on a task opens the board's usual task dialog; questions and experiments have their own popup. A question can be converted into a real task.
- A task or experiment can be on a project's canvas once. A task that no longer exists leaves a placeholder card.

- `src/sql/custom/096_project_canvas.sql` — `todolist_canvas_nodes`, `todolist_canvas_edges` (registered in `CustomMigrationRunner`)
- `src/Models/TodolistCanvas.php`, `src/Models/TodolistCanvasEdges.php` — API endpoints `todolist_canvas` (`GET ?project_id=&include_subprojects=1`) and `todolist_canvas_edges`; project access follows the board rules
- `src/ts/components/ProjectCanvas.svelte`, toggle in `ProjectManagementBoard.svelte`; styles are `.pmc-*` in `src/scss/main.scss`

### Steps, @mentions and tasks on the boards

(Code: `src/Models/StepMentions.php`, `Steps.php`, `Comments.php`, `src/ts/comment-mentions.ts`; migrations 089-092.)

- **Comments**: `@Full Name` notifies the person (setting `notif_mentioned_entry`) if they can read the entry.
- **Steps**: an `@Name` in a step makes the step's author the assigner and each mentioned person an assignee with their own to-do task
  (linked to the entry, deadline copied) and a notification. Editing the step updates the tasks; removing a name removes that task;
  deleting the step removes them; clearing the step's deadline clears it on the tasks. Assignees who cannot open the entry still get the task and a nameless notification.
- **Completion**: one assignee ticking their task, or anyone ticking the step, completes the step and every other assignee's task.
  The assigner and the other assignees are notified; reopening reopens everything.
- In every `@` box Up/Down move, Tab takes the highlighted name. A task linked to an experiment opens its popup on the experiment page.
- Boards: the card list under "All links" opens inside its row, an item linked from several cards shows how many; to-dos can repeat
  (daily, weekly, days of the week, monthly, yearly, every N, optional end) and the next one is created on completion.

## Well plates and recent spreadsheet changes

### Well plates

A well plate (6, 12, 24, 48, 96 or 384 wells) is a spreadsheet table with `kind: 'well-plate'` (the Insert menu's spreadsheet
grid and the plate submenu create it). Its size is fixed: no inserting or deleting rows or columns, by key, menu or button, inline or in the popup.

- **Compact view in the text** (`src/ts/well-plate-view.ts`, styles `.wp-*` in `src/scss/main.scss`): round wells, hover shows
  a well's contents, a legend lists the colour groups as a dot and the group name only. Every plate up to 96 wells is as wide
  as the 96-well plate (wells are bigger on the small plates); the 384-well plate stays smaller.
- **Groups**: a well's group is its cell background colour. The plate popup has a group list and a new-group box (Tab moves between
  group names); Ctrl/Cmd/Shift select wells.
- **Plate / Spreadsheet switch**: the buttons in the table header switch between the plate and the grid. The choice is saved with the
  table (`plateView`) and is what is printed.
- **Plate table and dynamic groups**: each well can carry a row of a plate table (`plateTable`: `columns`, `rows` keyed by well, e.g. `A1`).
  "Colour by" and "Label by" (`plateGroupBy`, `plateLabelBy`) colour or label the wells by any column of that table. The table opens
  as a full spreadsheet; "Back to plate view" returns.
- **Insert from CSV / XLSX**: in every Insert menu (toolbar, context menu, slash command). It always asks for the plate size, because
  partly filled plates are common (`plateTableSource` records the file name).
- Data: `data-spreadsheet` holds `kind`, `plateSize`, `plateGroups`, `plateView`, `plateTable`, `plateGroupBy`, `plateLabelBy`,
  `plateTableSource`; normalised by `normalizePlateTable` in `src/ts/inline-spreadsheet.ts`.
- **Plate editor (popup)**: the side panel scrolls on its own; the Selection box (contents, Set contents, Remove group) is at the
  top and only shows while wells are selected; a click outside the wells and the side panel clears the selection.
- **Copy and paste a plate**: the copy button in the plate's header (`copyPlateToClipboard` in `well-plate-view.ts`) puts the whole plate on the
  clipboard: tab-separated text (header row of column numbers, then a letter and the wells) and the plate's own table markup in a
  `data-elabftw-rich-selection` wrapper. Pasting into the main text outside a table (`spreadsheetPasteHandler` in
  `SpreadsheetExtension.ts`, `wellPlateFromClipboard`) rebuilds a new, separate plate from the data in the markup (the editor's paste filter strips
  the cells' colours, so the plate is rebuilt, not taken from the pasted HTML). Excel and Sheets get the grid as text.
- **View pages**: `activateLazySpreadsheetViews` (`inline-spreadsheet.ts`) swaps the plain table for the plate with `buildViewHost`. There the
  plate has the Plate | Spreadsheet buttons (`onShowSheet` / `onShowPlate`) and the "Colour by" / "Label by" lists on a working copy
  (`structuredClone`) that is never saved: choices are lost on reload and when the plate is scrolled far out of view and mounted again.
  Plates and spreadsheets in or near the window are built when the script starts (`mountTable`), not after the observer's first
  report, and `main.scss` hides the plain well-plate table on screen until it is replaced. Printing follows the form shown;
  `restoreStaticSpreadsheetsForPrint` leaves the buttons and the `.wp-choice` lists out.

### Spreadsheet changes (October 2026)

- Up to 400 rows and columns (a 384-well plate's table needs 385 rows).
- **Paste transposed**: Ctrl/Cmd+Shift+V and "Paste transposed" in the right-click menu, in the inline grid and the popup. When the browser
  does not let the page read the clipboard, a small box asks to press Ctrl/Cmd+V. Right-click **Paste** works the same way
  (a menu click clears the grid's selection, so the clicked cell is selected before pasting).
- Undo and redo also cover formatting changes (inline grid and popup), inserting and deleting rows and columns, dragging a row or column
  border and the two autofit buttons (`StructureChange` entries carry `beforeWidths` / `afterWidths` / `beforeHeights` / `afterHeights`; the
  popup keeps restored sizes with `mountSpreadsheet(spreadsheet, keepGivenSizes)`), and a paste inside a grid (one entry per paste,
  `createPasteUndoRecorder`: `onbeforepaste` notes the target cells, `onpaste` hands over the cells that changed).
- **Formulas move on paste, like Excel**: the grid's own copy never runs (the app writes the clipboard itself), so every copy in the inline
  grid and the popup is remembered (`rememberGridCopy`: the text put on the clipboard, the raw cell contents behind it and where the
  range came from). `createFormulaPasteShift` (`onbeforepaste`) swaps in the raw formulas of the last copy, shifted by how far they travelled
  (`shiftFormulaReferences`, `$` anchors stay), when the pasted text is exactly what that copy put on the clipboard; text from elsewhere pastes as it is.
  A repeated paste (into a larger selection) shifts each repeat by its own offset. Cut is not handled specially.
- Enter while editing commits and moves down; in the last row it stays and a further Enter adds a row. Autosave starts after an insert, a paste and every grid edit.
- The editor frame grows to fit its text when the built-in autoresize stops short (no scrolling inside the editor after quick typing).
  It also re-measures on every `input` event (`tinymce.ts`), because the plugin only measures on key release, so the bottom edge no longer lags Enter.
- **Printing**: File > Print everything / Print main text (`src/ts/print-main-text.ts`) prints an isolated copy. The editor keeps a spacer
  `<div data-elabftw-spreadsheet-spacer>` after each table with a negative margin when the overlay is shorter than the table; the print copy
  drops them (`restoreStaticSpreadsheetsForPrint`), otherwise tables and plates print on top of each other when printing from the edit page.
- A notebook-style table's preview is sized from its own rows (no blank gap under long tables).
- Typing into a grid keeps the page where it is: the grid's hidden input (`.jss_textarea`) can sit far from the visible cell and the browser
  scrolled to its caret. `inline-spreadsheet.ts` focuses it with `preventScroll` and puts the page back after typed text (keydown and `beforeinput`).
- Test checklists: `tests/manual/SPREADSHEET-FULL-CHECK.md`, `tests/manual/TEST-LIST.md`.

## Folders: back to the folder, folder path bar

- **Back goes to the folder**: for an experiment or resource filed in a folder, the back arrow on the view page (`back-to-previous.html`), the
  back arrow on the edit page (`view-edit-toolbar.html`) and "Save and go back" (`data-redirect='folder'` with `data-folder-url`, handled in
  `update-entity-body` in `src/ts/common.ts`) open `?folder=<id>`. Entries without a folder behave as before (listing / view page).
- **Folder path bar** (`src/templates/folder-path-bar.html`, `.folder-path-bar` in `main.scss`): the path of the folder, for example
  `Vatsi > EV Project > Trogocytosis`, under view and edit pages (`view.html`, `edit.html`) and under a folder's list (`show.html`, when `?folder=<id>`).
  Each part opens that folder (`experiments.php?folder=` or `database.php?folder=` for resources). The path is built from the hierarchy rows
  (`readHierarchyRows`, `parent_id`). The last button lists the folder's subfolders in an upward menu. The bar is `position: sticky; bottom: 0`
  so it stays at the bottom of the window, and it is hidden in print.
- **Create popup**: "New folder" has a Parent folder list, so nested folders can be created there (`create-new-modal.html`, `create-new.ts`).
- **Feedback board**: the author or a team admin can change an item's type (bug or feature) when editing it (`Feedback.php`, `FeedbackBoard.svelte`).

## HTML tools: sending results to the main text

The HTML tools feature (sysadmin-installed `.html` or `.zip` tools in a sandboxed frame, opened from the toolbox icon in the side panel,
`HtmlToolsPanel.class.ts`, `HtmlTools.php`) is switched on with `FeatureFlags::HTML_TOOLS` (it was off; the flag's comment says to flip it once the
implementation is ready). `src/ts/html-tool-bridge.ts` lets a tool hand a result to the entry being edited: the tool calls
`window.parent.postMessage({ elabftw: 1, type: 'insert-plate' | 'insert-table' | 'insert-text', ... }, '*')`; the page takes a message only from the tool
frame's window, rebuilds it from plain strings (colours checked, sizes capped) and inserts it at the cursor as one undo step through the editor
command `elabftwInsertSpreadsheetData` (`SpreadsheetExtension.ts`). Message format, and the qPCR tool with its three "→ eLabFTW" buttons: `docs/html-tool-bridge/`.

## General Merge Notes

- eLabFTW uses Yarn PnP (no `node_modules` directory) — packages are in zip archives
- Build: `docker exec elabftw bash -c 'NODE_OPTIONS="--max-old-space-size=4096" yarn buildall'`
- Dev rebuild: `docker exec elabftw bash -c 'NODE_OPTIONS="--max-old-space-size=4096" yarn build:dev --watch'`
- Global event delegation: all `[data-action]` clicks are intercepted by `#container` listener in `src/ts/common.ts` — use `on(action, fn)` from `src/ts/handlers.ts`, not direct `addEventListener`
- HTMLPurifier config in `src/Services/Filter.php` must whitelist any new HTML attributes/classes

## Orders: shop sheet drop area and the "Collected" status

- The orders page has a drop area for the signed shop sheets ("Rüstschein" PDFs). For each PDF the procurement number
  after "Rüstschein" is read (`src/Services/ScanReader.php`: the text layer first, then OCR with Ghostscript and
  Tesseract, which are in the image: see `containers/elabimg/Dockerfile`), the PDF is attached to every order of the
  team with that procurement ID (`src/Models/OrderSheets.php`, endpoint `api/v2/order_sheets`), those orders become
  `collected` (migration 097) and the people who placed them get the notification "Orders from this procurement have
  been received: Please check if your order has been collected." (`OrderChanged` with reason `received`).
- Dropping the same sheet again does not attach it twice. Only ordered orders become collected; any other status stays.

### Watched folder for shop sheets

`orders:import-sheets` (every 5 minutes, see `chronos.go`; reads at most 10 files per run) takes new PDFs from `ORDER_SHEETS_DIR`
(default `/var/lib/elabftw/order-sheets`, the `elabftw-order-sheets` volume, or the host folder in `ORDER_SHEETS_HOST_DIR`)
and treats them like a drop on the orders page. Handled files move to `done/`, `unmatched/` (no order has that number
yet: tried again each run) or `unreadable/`. `ORDER_SHEETS_USERID` is the account the attachments are attributed to
(default: the first sysadmin).

### Items collected per procurement

The article numbers read from a collection sheet are compared (allowing for OCR misreads) with the rows of the basket
("Warenkorb") in the procurement's confirmation PDF, attached to one of its orders. The items seen so far are kept per
procurement (`custom_order_sheet_items`, migration 098), so a second sheet for the same procurement adds to them. The
notification and the drop result show the count ("3/4 items collected"). Without a confirmation PDF there is no count.

### Collected notification, statuses and the Order Status tab

- The notification now reads "Orders from Procurement 26049739 (order names) has been collected. Please check if your item has been
  delivered." (plus the count, e.g. "3/4 items collected"). It has its own in-app and email settings in the profile
  (`notif_order_collected`, `notif_order_collected_email`, migration 101); the general "my order was updated" settings are separate.
- Status `received` is shown as **In storage** and sits after **Collected**. Only an ordered order becomes collected.
- **Order Status** tab (everyone in the team, `web/order-status.php`, `src/ts/components/OrderStatus.svelte`): every procurement with its order
  numbers, dates, requesters and *Items collected*, searchable, date range, **My orders / Everyone** and a users dropdown. A row expands
  to the orders, the items with the sheets that collected them and the **Signed Sheets** (file names, openable PDFs). Refreshes every 30 s and when
  the tab is shown again; changes made on the Orders page (a deletion, for example) show up here too. Pagination above and below.
- **Collection sheets**: the drop area is called collection sheets and shows a rectangle while files are dragged over the page; each result is a notification.
  Everyone with an order on the sheet is notified, whoever drops it.
- **Reading scans** (`ScanReader.php`): the sheet is rendered at 300 dpi and read in two Tesseract modes (line by line and sparse text), so article numbers
  between the table's rules are found. A garbled article number is matched with a few differing characters, or by the item's description.
  The basket reader accepts any unit, currency and price format.
- Dropping the same sheet twice, even under another file name (`Scan.pdf` and `Scan[1].pdf`), attaches it once and notifies once
  (`OrderSheets::identicalUpload` compares the content).
- Sheets recorded before their item list could be read are matched again (`orders:import-sheets` does it each run).

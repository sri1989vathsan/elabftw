# eLabFTW Fork Changes Summary

This document summarizes the changes made from the initial `aemoor/elabftw` fork through the current `codex/pyrat-integration` branch.

## 1. Spreadsheet tables inside the main text

A spreadsheet-style TinyMCE table editor was added, including:

- Spreadsheet insertion directly into experiment/resource text.
- Standard, custom, and well-plate dimensions.
- Current spreadsheet dimensions shown when reopening the editor.
- Add-row and add-column controls.
- Multi-cell selection and range selection.
- Cell selection while entering formulas such as `=SUM(A1:A4)`.
- Formula persistence when closing and reopening the spreadsheet.
- Formula results displayed in the editor while the underlying formula remains editable.
- Aggregate functions: `SUM`, `AVERAGE`, `COUNT`, `MIN`, and `MAX`.
- Addition, subtraction, multiplication, division, cell references, and ranges.
- Excel-style paste handling.
- CSV and tab-separated paste handling.
- Attempts to reconstruct tables copied from PDFs.
- Preservation of spreadsheet contents when reopening the popup.
- Alternating row and column colouring.
- Protection against regressions where formula-containing spreadsheets disappeared.

## 2. Spreadsheet formatting

The spreadsheet editor gained formatting controls for selected cells:

- Cell background colour, including **No colour**.
- Border colour, width, and style.
- Font family and size.
- Bold, italic, and underline.
- Font colour, including **No colour**.
- Horizontal and vertical alignment.
- Automatic application when a property changes, without separate Apply buttons.
- Clear-cell-formatting action.
- Format preservation when reopening a spreadsheet.
- Default table and cell appearance settings.
- Notebook-level and account-level defaults.
- Alternative-row and column styling defaults.
- Compact appearance controls.
- Table captions displayed above tables.
- Table indentation and list-relative indentation improvements.

TinyMCE also gained a format painter and remove-formatting action with icon-based toolbar buttons.

## 3. Editor behaviour and document formatting

- `- ` automatic bullet-list creation.
- `1. ` automatic numbered-list creation.
- Tab and Shift+Tab indentation.
- Nested numbered-list styles progressing through numbers, letters, and Roman numerals.
- Hollow-square checklist items.
- Better indentation for tables inside lists.
- Single and double horizontal lines.
- Single and double dashed horizontal lines.
- Print selected or filtered content with the notebook title.
- Selection of headings for printing.
- Sticky editing controls and primary navigation.
- Correct stacking of menus and Create dialogs above floating toolbars.
- Fixes for TinyMCE focus being blocked by sidebar controls.
- Back and Save-and-go-back return to the experiment view instead of the global list.

## 4. Date insertion and title tools

Date insertion gained:

- Quick insertion using saved defaults.
- Calendar-based selection.
- Multiple date formats.
- Optional calendar badge/icon.
- Custom background colour.
- Linked dates.
- Optional heading treatment.
- Saved account defaults.

Custom title insertion gained:

- Experiment-title or custom-text insertion.
- Dedicated toolbar shortcut.
- Font, colour, size, and style controls.
- Background across the full heading or only behind the text.
- Multiple saved title styles.
- Account and notebook defaults.

## 5. Left floating sidebar

A persistent, resizable sidebar was created with tabs for:

- Table of contents.
- Folders.
- Filters.
- Tasks and steps.
- Calendar.
- Tools and integrations where enabled.

General improvements include sticky navigation buttons, reduced scroll jumping, adjustable width, light/dark styling, improved contrast, refined accordions, empty-TOC hiding, and sidebar refresh controls.

## 6. Table of contents

- Search with multiple simultaneous terms.
- Hierarchy-aware matching.
- Descendant headings remain visible when an ancestor matches.
- Main-text filtering based on TOC search.
- Direct links for headings and subheadings.
- Copy and insert-link actions without changing heading text.
- Current-section highlighting, including edit mode.
- Refresh control.
- Heading selection for printing.

## 7. Filters and sidebar search results

- Categories, tags, owners, statuses, and text search.
- Combined filtering across multiple filter types.
- Favourite filter values.
- User-specific tags and tag suggestions.
- Collapsible filter groups.
- Apply Filters navigation.
- Search results rendered in the sidebar.
- Links to experiments/resources and their headings.
- Unsaved-change warnings before navigation.
- Separate actions for attaching a result and inserting it into the main text.
- Reusable Add-to-text action.
- Theme-consistent compact result cards.
- Sidebar remains open while favourites are changed.

## 8. Folders

- Dedicated folder sidebar tab.
- My Folders and All Folders views.
- Root folders with nested child trees.
- Correct ownership filtering and duplicate removal.
- Multiple bookmarked folders.
- Bookmarked folders shown prominently.
- Other folders collapsed by default.
- Folder creation from the sidebar.
- Sidebar refresh after folder changes.
- Folder clicks filter experiments/resources assigned to that folder.
- Create dialogs provide My, Bookmarked, and All folder scopes.
- Folder descriptions.
- Category descriptions for experiments and resources.

## 9. Experiment summaries

Experiments now have three optional summary fields:

- **Goals**
- **Conclusion**
- **Notes**

Each field supports up to 1,000 characters and is preserved during creation, editing, duplication, reading, and experiment-list rendering. The view presentation is plain and aligned, while list summaries may be collapsed to keep lists compact.

The latest summary-field implementation is commit `0df409691`.

## 10. Tasks, reminders, and calendar

Tasks and Steps gained:

- Title, notes, due date/time, and reminder date/time.
- Current date/time defaults.
- Reuse of the last selected date.
- Editing of task details.
- Today, Tomorrow, Overdue, and Later groupings.
- Completed-task history with configurable time windows.
- Separate All Completed Tasks view.
- Ordering by due date and groundwork for drag/reordering.
- Notification badges only for overdue tasks or tasks due within one hour.
- Completed tasks excluded from active badges.

Calendar work includes a modern month view, task counts, agenda view, current and historical tasks, external calendar links, experiment/resource headings as calendar entries, user/team scope, and a sidebar refresh control.

## 11. Themes and accessibility

- Account-level complete-page colour themes.
- Light and dark mode support.
- Sidebar theme consistency.
- Improved contrast for tasks, agenda entries, calendars, filters, links, buttons, headings, and external-calendar information.
- Spreadsheet colours adapted to application themes.

## 12. Linking and external references

- Direct links to experiment/resource headings.
- Link insertion into selected TinyMCE text.
- Filter-result links in the main text.
- Entity attachment without mandatory text insertion.
- LabCollector links in the TinyMCE link dialog.
- Unsaved-change warnings before navigation.
- Internal links may open in a new tab.

## 13. HTML Tools

An administrator-managed HTML tool system was developed with an admin interface, right-side tool panel, theme support, and fixes for gateway and database compatibility issues.

**Current status:** HTML Tools are feature-gated and deactivated. The code remains available for later activation but is not intended for current production use.

## 14. PyRAT and animal-study integration

A PyRAT prototype added animal/cage lookup, experiment links, score-sheet history, mouse/cage searching, TinyMCE link insertion, and observation fields for permits, personnel, dates, weight, medications, clinical findings, comments, and total score.

**Current status:** Animal Studies, animal controls, and the TinyMCE mouse button are greyed out and disabled behind feature gates. The code remains for future activation.

## 15. Docker and build reproducibility

- Removed reliance on the development `.:/elabftw` bind mount for production.
- Composer dependencies are generated inside the image.
- Frontend assets are generated inside the image.
- `vendor/autoload.php` and compiled bundles are included in the finished image.
- Corrected the fresh-database deadline-index failure.
- Separated custom migrations from official eLabFTW migrations.
- Added custom schema update and migration-init support.
- Improved Compose migration ordering.
- Made frontend build memory configurable.
- Tested local HTTPS deployment.
- Repeatedly validated clean Git-archive production builds.

The latest clean build confirmed that no local `vendor/` directory or generated frontend assets are required. The application responds at `https://localhost:3149`.

## 16. Upstream compatibility restructuring

- Merged stable upstream work into a compatibility-focused branch.
- Kept official eLabFTW migrations unchanged.
- Moved custom migrations under `src/sql/custom`.
- Separated custom and official schema tracking.
- Placed optional integrations behind feature gates.
- Used a generic custom UI-description store for descriptions and experiment summaries.
- Avoided incorporating the eLabFTW 6 alpha schema series into the stable production path.
- Kept the official database schema at version **219**.

## Current repository state

- Branch: `codex/pyrat-integration`
- Remote branch: `origin/codex/pyrat-integration`
- Current head: `0df409691 Add experiment notes summary`
- Official schema: **219**
- Custom schema: current
- Local deployment: `https://localhost:3149`

The fork now provides a scientific-writing and organization layer around eLabFTW—spreadsheets, formatting, navigation, folders, filters, tasks, calendars, experiment summaries, and optional integrations—while isolating custom schema and unfinished integrations to make future upstream merges safer.

#!/usr/bin/env python3
"""Rewrite the text of the guide cards (and fix a few dated entries) in src/whats-new.json.

Run from the repository root:  python3 whats-new-screenshots/guide-text.py
It only touches summary, details, purpose, uses and news (plus new guide-* entries); ids, areas, images and highlights stay.
"""
import json
from pathlib import Path

PATH = Path(__file__).resolve().parent.parent / 'src' / 'whats-new.json'

TEXT = {
 'guide-folders': dict(
  summary='A shared tree of folders for experiments and resources, each with a README and its own permissions.',
  purpose='Keep the lab organised in folders the whole team sees, and decide once who can see and edit what is in a folder.',
  uses=['One folder per project, with a README that lists the protocols and naming rules.', 'A subfolder for each idea you want to test, so the approaches sit side by side.'],
  details=[
   'fa-folder-tree::Open the Folders button in the left sidebar. Click a folder to list only what is inside it; the number beside it counts its items.',
   'fa-folder-plus::Press New folder, give it a name and pick a parent folder to nest it. Choose the folder when you create an entry or on its edit page.',
   'fa-file-lines::Press the page icon on a folder to open its README. The owner and admins edit it; everyone who can see the folder reads it.',
   'fa-ellipsis-vertical::The three dots on a folder give Export, Edit (rename, move, description), Permissions and Delete. Deleting moves its items to Unfiled.',
   'fa-user-shield::Permissions (owner and admins): set Can see and Can edit as on an entry, tick Include subfolders, press Apply and confirm.',
   'fa-star::Star a folder to bookmark it. The Refresh button at the top of the panel loads the tree again.',
  ]),
 'guide-folder-views': dict(
  summary='Browse folders like a file explorer: as a tree, a list with preview, or cards. Drag a file or folder onto a folder to move it.',
  purpose='Find a folder quickly in a big lab, see what is in it and file work by dragging, without leaving the page.',
  uses=['Switch to Cards to see what each folder holds.', 'Drag an experiment from Unfiled into its project folder.'],
  details=[
   'fa-table-list::The buttons at the top of the Folders panel switch between Tree, List and Cards. Your choice is remembered.',
   'fa-layer-group::List and Cards open one folder at a time: click a folder to go in, use the “..” row or the path bar to go back up.',
   'fa-flask::Exp, Res and All choose which entries the panel shows; Unfiled lists entries that are in no folder.',
   'fa-up-down-left-right::Drag a file or folder onto a folder, the “..” row, All (folders only) or Unfiled (files only). A message with Undo appears.',
   'fa-ellipsis::The three dots at the top switch Favourites, Files and Counts on or off. Drag the panel’s right edge to make it narrower.',
  ]),
 'guide-sidebar': dict(
  summary='The slim row of buttons on the left edge: folders, search, quick search, to-do, calendar and contents, one click away.',
  purpose='Keep the tools you use all day next to your work and reach anything without hunting through menus.',
  uses=['Keep the To-do panel open and tick off steps as you finish them.', 'Press Ctrl+K and type a few letters to jump to an entry.'],
  details=[
   'fa-bars::Click a button to open its panel next to your page and click it again to close. The last panel you opened is remembered.',
   'fa-left-right::Drag the right edge of a panel to resize it, or click the edge and press the Left and Right arrow keys.',
   'fa-bolt::Quick search and commands: Ctrl+K (Cmd+K on a Mac) on any page. Type to find commands, folders and entries; Enter opens one.',
   'fa-list-check::To-do and Activity calendar show a red number for what is overdue or due soon. Contents appears on entry pages only.',
   'fa-rotate::Every panel has Close and Refresh in the top corner, in the same place. Refresh reloads that panel without leaving the page.',
   'fa-bars::On a narrow window the row folds into one button left of the logo.',
  ]),
 'guide-calendar': dict(
  summary='One calendar for what is coming and what you finished: your tasks, the steps of your experiments and the days you worked.',
  purpose='See what is due this week, never miss a step deadline hidden inside an experiment, and look back at earlier days.',
  uses=['Switch to Week view on Monday to see every deadline.', 'Look back at what you did on a given day.'],
  details=[
   'fa-calendar-days::Open the calendar button in the left sidebar. A red number counts what is overdue or due within the hour.',
   'Choose Day, Week or Month. The agenda below the grid lists what you selected in time order and says if an item is a task or a step.',
   'Tasks and steps with a deadline show on their day; finished ones stay on the day you finished them. Click a step to open its experiment.',
   'fa-calendar-day::The Day button in the editor toolbar lists the headings you write after a date on that date.',
   'The User and Team buttons switch between your items and the team’s. Add a task with a date, time and reminder from the panel.',
   'fa-link::Subscribe from Google or Apple Calendar with the private, read-only link on the Calendar tab; you can regenerate or revoke it.',
  ]),
 'guide-boards': dict(
  summary='Plan lab work as projects of cards with deadlines and steps, and link each card to its experiments and resources.',
  purpose='Keep track of who does what and by when, with the plan and the experiments pointing at each other.',
  uses=['One board per paper or grant, a card for each series of experiments.', 'Link a card to the experiments that belong to it.'],
  details=[
   'fa-list-check::Open Boards from the top bar (under More). Create a project, then add cards. A card has notes, a deadline, steps, comments and people.',
   'fa-link::Link experiments and resources from the search panel beside a card; each shows a status dot. All links lists every link of the project.',
   'fa-brain::The brain button switches between columns and a Mind map of cards and arrows. Each project keeps its own map.',
   'Tick several cards to archive or delete them together. Pin to top in a card’s ⋮ menu keeps it at the top of its column.',
   'Drag a project tab to reorder it. A project can hold subprojects. Archive a finished project from its edit dialog.',
   'fa-floppy-disk::Columns or mind map, card size (compact or expanded) of each project and the last project tab are saved with your account.',
  ]),
 'guide-orders': dict(
  summary='Request what the lab needs and follow each order from request to delivery.',
  purpose='One place to request what the lab needs and to see where each order is, instead of emails and sticky notes.',
  uses=['Request a reagent with the supplier quote attached.', 'Drop the signed shop sheet and see the order become Collected.'],
  details=[
   'fa-cart-shopping::Open Orders from the top bar (under More) and press New order. Add supplier, link or catalogue number, notes and attachments.',
   'fa-clone::Copy an order to fill the request form again; use the arrow beside a file (Add to new order) to reuse an attachment.',
   'Status: Requested, Ordered, Collected, In storage, Backlogged or Cancelled. Use the coloured dropdown, or tick several and Move to status.',
   'fa-file-pdf::Drop the signed shop sheet (PDF) on the dashed area at the top: it is attached to the matching orders, and an Ordered one becomes Collected.',
   'fa-clipboard-check::Order Status lists each procurement with its orders and how many items were collected. Templates keep texts such as supplier emails.',
   'fa-thumbtack::Pin an order to keep it at the top. Pinned for all is shared with the team; Reference is only yours. Admins can turn auto-collect off.',
  ]),
 'guide-experiment-sections': dict(
  summary='Connect an experiment to the data folders, resources, orders and templates it relates to.',
  purpose='Record not only what you did but also what you used, where the data lives and what it relates to.',
  uses=['Link the resource of the meeting where the experiment was planned.', 'Add the network folder with the raw data.'],
  details=[
   'Scroll below the main text. Each section opens and closes on its own.',
   'fa-list-check::Steps and tasks: a checklist with deadlines. Type @ in a step to give it to a colleague (see Steps and tasks).',
   'Data: paste a network path (smb://server/share/folder), add a label and press Add. Buttons open it on a Mac or copy the Windows path.',
   'fa-link::Links: other experiments, resources, orders, templates, web addresses and LabCollector entries.',
   'fa-paperclip::Files / folders and Local files: attach files or refer to files kept elsewhere.',
   'Compounds and Custom fields: record chemicals from the compound database and the extra fields your team defined.',
  ]),
 'guide-steps': dict(
  summary='Break an experiment into steps, give a step to colleagues with @ and see when it is done.',
  purpose='Hand a part of an experiment to a colleague and see when it is done, without chasing them.',
  uses=['Ask a colleague to prepare the buffers and be told when they are ready.', 'Give a step to two people; it closes for both.'],
  details=[
   'fa-list-check::Steps and tasks sit under the main text. Type a step in the box and press Enter. Tick it when done; drag its handle to reorder.',
   'fa-clock::Open the arrow on a step to set a deadline and a reminder. It then shows in the To-do panel and the Activity calendar.',
   'fa-at::Type @ in a step and pick a name. Each person gets a to-do of their own, linked to the entry, and a notification. You are the assigner.',
   'fa-circle-check::When anyone you gave it to ticks their to-do, or anyone with edit rights ticks the step, it is done for everybody. Unticking reopens it.',
   'fa-bell::You and the other assignees are told when the step is completed, not the person who did it. Choose web or email in Settings > Notifications.',
   'The same @ list works in comments. The Open steps tile on the dashboard counts what you still have to do.',
  ]),
 'guide-templates': dict(
  summary='Link a template to an experiment, see which version you used and restore older versions.',
  purpose='Start from the lab’s standard protocol and know exactly which version of it an experiment followed.',
  uses=['Publish a new version when the standard protocol changes.', 'See which experiments used version 2.'],
  details=[
   'In Search (left sidebar) set Type to Experiment templates. Link records the template; Add to text inserts its content.',
   'Associated templates are listed under Links with their version and how often they were inserted.',
   'fa-code-branch::Press Publish new version in a template’s toolbar. Versions are numbered and never overwritten.',
   'fa-clock-rotate-left::Version history lists each version with who and when. Edit a version’s name and notes; Restore makes the template look like it did then.',
   'fa-code-compare::Tick two entries and press Compare revisions. Each version also has an Edit history you can restore from.',
   'fa-star::Star the templates you use most to find them quickly.',
  ]),
 'guide-feedback': dict(
  summary='Post ideas and bugs, upvote what matters and discuss it with your team.',
  purpose='Tell the people who run the system what would help, and see what the team cares about most.',
  uses=['Ask for a new field and see how many colleagues want it too.', 'Report something that does not work and follow it.'],
  details=[
   'fa-lightbulb::Open Feedback from the top bar and post an idea or a problem with a title and a description.',
   'fa-star::Choose Feature or Bug. The two buttons above the list also filter it.',
   'fa-caret-up::Upvote the items that matter to you; you upvote your own post automatically. Sort by Most votes or by date.',
   'fa-comment::Open an item to comment; type @ and a name to mention a colleague.',
   'fa-pen::The author or a team admin can edit an item, change its type and status (open, planned, done or declined) and delete it.',
  ]),
 'guide-search-filters': dict(
  summary='Search with your favourite filters, then attach what you find to an experiment or paste a link, without leaving the page.',
  purpose='Stop re-entering the same filters, and link what you find into your work in one click.',
  uses=['Favourite your tags and statuses, then filter “my running experiments” in two clicks.', 'Attach a resource while you edit.'],
  details=[
   'fa-magnifying-glass::Open Search in the left sidebar, pick a Type (All, Experiments, Resources, Experiment templates, Resource templates) and type.',
   'Tick filters (categories, tags, statuses, owners) and press Apply filters. Manage chooses your favourites, saved with your account.',
   'fa-link::While editing, press the link button on a result to attach it under Links, or the second button to paste a link into the text.',
   'For templates, the link button records the template and the second button inserts its content.',
   'With a board card open, results also have buttons to link them to the card or add them as a step.',
  ]),
 'guide-toc': dict(
  summary='A list of the headings of an entry to jump around, show only the sections you pick and print or export just those.',
  purpose='Long experiments become easy to move through, and you can share just the part someone needs.',
  uses=['Print only the Results of a long experiment for a meeting.', 'Copy the Methods into an email.'],
  details=[
   'fa-bars-staggered::On an entry open Contents in the left sidebar. Click a heading to jump to it; levels show by indent and weight.',
   'Type in Filter headings and press Enter to add a filter; with several, choose All or Any. Tables and pictures can be hidden.',
   'fa-square-check::Select turns the rows into tick boxes: click to tick, Shift-click for a range, Select all or None. The entry then shows only those sections.',
   'fa-print::Print and PDF in the panel header act on the ticked sections, or on the whole entry when nothing is ticked. The PDF window says so.',
   'fa-copy::Copy, in the bar at the bottom, copies the ticked sections. Clear drops the selection.',
   'fa-rotate::Refresh and Close sit in the top corner of the panel, as on every side panel.',
  ]),
 'guide-todo-notifications': dict(
  summary='The bell tells you what needs you, so you do not have to check every page.',
  purpose='Be told when something changes for you, without checking every page.',
  uses=['Be told right away when someone shares an experiment with you.', 'Get an email for a step someone gave you.'],
  details=[
   'fa-bell::The bell in the top bar collects your notifications and shows how many are new.',
   'fa-user-check::You are told when you get access to an entry, are mentioned, are assigned a task, card or step, or an order changes.',
   'fa-gear::Settings > Notifications: every kind has a Web switch (the bell) and an Email switch. The top row switches all kinds at once.',
   'fa-envelope::Turn Email off to get a kind only in the app, or Web off to get it only by email.',
  ]),
 'guide-editor-toolbar': dict(
  summary='The buttons above the text of an entry: save, one Insert menu, dates, titles, notes, checklists and spreadsheets.',
  purpose='Find every editing tool in one place and write and structure an experiment faster.',
  uses=['Use Log entry in the Day arrow each time you return, so your notes read as a diary.', 'Save a title style and apply it to other headings.'],
  details=[
   'fa-floppy-disk::Save keeps your changes and shows when they were saved; Save and go back opens the view page. File has the Print entries.',
   'fa-plus::Insert is one menu: note, divider, tables, spreadsheet, well plate, image, links and template. Title and Day have their own buttons.',
   'fa-calendar-day::Day inserts today’s date and links your notes to the Activity calendar. The arrow gives Custom date and Log entry (date and time).',
   'fa-heading::Insert title sets text, style and how it shows in Contents; Ctrl+Alt+T opens it. Save style keeps a style for later.',
   'fa-list-check::Checklist: type [ ] and a space for tick boxes. Format painter and Clear formatting sit by the colour buttons.',
   'fa-keyboard::Ctrl+Shift+D date and time, Ctrl+Alt+T title, Ctrl+Alt+N note, Ctrl+Shift+H line. The three dots at the end hold buttons that do not fit.',
  ]),
 'guide-spreadsheets': dict(
  summary='Put a spreadsheet or well plate in the text, fill it like a normal sheet and keep a plate layout fixed.',
  purpose='Record plate layouts, measurements and calculations next to your notes, in a table that behaves like a spreadsheet.',
  uses=['Insert a 96-well plate and type sample names into the wells.', 'Add a formula to calculate each concentration of a dilution series.'],
  details=[
   'fa-plus::Insert > Spreadsheet: drag over the squares for a size, or Custom. Well plate gives a 6 to 384-well plate. Click a table to work in it.',
   'fa-keyboard::Tab moves to the next cell, Enter down, Shift+Enter opens the Spreadsheet Editor. Add rows under the table; right-click a header for more.',
   'fa-calculator::Start a cell with = for a formula, such as =A1+B1. Drag the fill handle to copy it; a $ keeps a reference fixed.',
   'fa-circle-dot::A well plate keeps its size and shows round wells. Plate and Spreadsheet switch views; Colour by recolours; the copy button duplicates it.',
   'fa-print::Print and PDF show the sheet like the grid you see. Choose how wide sheets print in the PDF window (see Print and PDF).',
   'fa-rotate-left::Ctrl+Z in a spreadsheet undoes spreadsheet edits only. A sheet wider than the page has a scroll bar under it.',
  ]),
 'guide-collaboration': dict(
  summary='Add colleagues to a project, assign cards to people and talk about the work in comments with @mentions.',
  purpose='See who is working on a project and who looks after each card, with the conversation next to the work.',
  uses=['Add the project team once, then assign each card.', 'Mention a colleague in a card comment.'],
  details=[
   'fa-user-group::Open a project’s edit dialog and use Team members on this project. Remove someone with the × on their name.',
   'A subproject starts with the members of its parent.',
   'fa-user::Open a card and choose people under Assigned to. Each gets a notification; Assigned to me above the board shows only your cards.',
   'fa-comment::Every card has Comments. Type @ and a name to mention someone; they are notified. Cards show a comment count.',
   'The same comments work on tasks in the To-do list and on posts in Feedback. You can edit or delete your own.',
  ]),
 'guide-todo': dict(
  summary='Your tasks and the deadlines of your experiment steps in one list: add, remind, repeat, tick off and look back.',
  purpose='Know what is due today and never lose a step deadline inside an experiment.',
  uses=['Add a task with a reminder the moment you think of it.', 'Set a weekly task to repeat on Monday.'],
  details=[
   'fa-list-check::Open the checklist button in the left sidebar. Tasks and steps with a deadline are grouped Overdue, Today, Tomorrow, later days.',
   'fa-plus::Type a task in the top box and press Enter. The arrow beside it adds notes, a board project, date, time and reminder.',
   'Reminders: at the deadline, 15 minutes, 1 hour, 1 day or 1 week before, or a time you choose. They need a date and time.',
   'fa-repeat::Repeat: Daily, Weekly, Every weekday, Monthly, Yearly or Custom. Completing a repeating task creates the next one.',
   'Click a title for notes, linked items, steps and comments. Archive, Duplicate and Delete are at the bottom of the details.',
   'fa-calendar::The Calendar tab shows a month and has Create private link for Google or Apple Calendar. Calendar settings are under the gear.',
  ]),
 'guide-announcements': dict(
  summary='Lab news on your dashboard: read it, react to it and look back at earlier announcements.',
  purpose='Make sure everyone hears about lab news and changes, without emails getting lost.',
  uses=['Read the latest lab news when you open the dashboard.', 'Pin the lab meeting schedule so it stays on top.'],
  details=[
   'fa-bullhorn::The Announcements card is on the dashboard. A New badge shows until you have seen one, and a notification tells you when one is posted.',
   'A blue circle marks information, a warning triangle something that needs attention, a pin an announcement kept at the top.',
   'Click the title to open it on its own page; Show more reads a long text.',
   'fa-face-smile::React with the face button under an announcement; you can pick several.',
   'See previous announcements lists older ones. Team admins add announcements with the plus button, and can edit and pin them.',
  ]),
 'guide-experiments': dict(
  summary='Where your experiments live: create them, find them and act on them.',
  purpose='Keep every experiment in one searchable place, from the first idea to the finished record.',
  uses=['Start a new experiment from a similar one with Duplicate.', 'Filter by status and owner to see what is still running.'],
  details=[
   'fa-flask::Open Experiments from the top bar or the dashboard. Create opens the Create window: type, title and folder.',
   'fa-magnifying-glass::Search above the list or in the left sidebar. Filter by category, status, owner, date, tags and custom fields, and sort.',
   'fa-table-cells-large::The layout buttons above the list switch Cards, Compact rows, Rows with preview, Board by status and Tabular (see Layouts of the lists).',
   'fa-square-check::Tick several to archive, delete, lock, change category, status or permissions, export or link them.',
   'fa-pencil::Edit opens the edit page. The view page shows Goals, Conclusion and Notes as three tiles under the title.',
   'fa-ellipsis-vertical::Duplicate, Lock and Timestamp are buttons; the three dots hold changelog, Transfer ownership, Archive and Delete.',
  ]),
 'guide-resources': dict(
  summary='Where your team keeps records that are not experiments, such as meetings or equipment, and how to find and use them.',
  purpose='Keep the shared records of the lab in one place that anyone can search and link to.',
  uses=['One resource per group meeting, linked from the experiments that came out of it.', 'Book an instrument.'],
  details=[
   'fa-cubes-stacked::Open Resources from the top bar or the dashboard. Create opens the same window as for experiments.',
   'fa-magnifying-glass::Search with the same filters and sorting as experiments; the list has the same layout buttons.',
   'fa-square-check::Tick several to archive, delete, lock, change category or status, export or link them.',
   'fa-pencil::Edit has the same text, toolbar and sections as an experiment. Duplicate copies a resource.',
   'fa-calendar-plus::Book item opens the scheduler, only when an admin has switched Bookable resources on (Admin panel, Team, Features).',
   'fa-link::Link resources from an experiment’s Links section so anyone can follow the trail.',
  ]),
 'guide-list-layouts': dict(
  summary='See experiments and resources as cards, compact rows, rows with preview, a board by status or a table.',
  purpose='Choose the view that suits the job: a quick scan, a preview while you read, or a board to follow progress.',
  uses=['Compact rows to scan a long list.', 'Board by status to see what is running and what is done.'],
  details=[
   'fa-table-cells-large::The buttons above the list switch Cards, Compact rows, Rows with preview, Board by status and Tabular.',
   'fa-list::Compact rows is one line per entry, grouped by month. Rows with preview shows the entry you pick beside the list; move with the arrow keys.',
   'fa-table-columns::Board by status has a column for each status. Tabular is a table you can sort.',
   'fa-thumbtack::Pinned entries come first in their own Pinned group in every layout.',
   'fa-floppy-disk::The layout is saved with your account, for experiments and resources separately.',
  ]),
 'guide-dashboard': dict(
  summary='The first page: four tiles, your experiments and resources, announcements and Create buttons.',
  purpose='Start the day with what changed and what is waiting for you.',
  uses=['Press Open steps to see what you still have to do.', 'Press a status chip to list those entries.'],
  details=[
   'fa-gauge::The tiles show experiments and resources changed this week and your open steps and tasks. A tile opens what it counts.',
   'fa-tags::The category and status chips show how many entries each has. Press one to list them; empty ones are dimmed.',
   'fa-plus::Each card has a Create button. For Announcements it is for admins and opens the Announcements tab of the Admin panel.',
   'fa-magnifying-glass::The search box on a card searches experiments or resources.',
  ]),
 'guide-create-entry': dict(
  summary='One Create window everywhere: type, title, folder and an optional template.',
  purpose='Start new work in the right place from the first moment.',
  uses=['Open a project folder and press Create: the folder is chosen.', 'Press Ctrl+K and type New experiment.'],
  details=[
   'fa-plus::Press Create on the dashboard or a list, use the plus in the top bar, or New experiment or New resource in Ctrl+K.',
   'fa-folder::Folder: Unfiled is first. My folders, Bookmarked and All folders narrow the list; New folder makes one on the spot.',
   'fa-clock-rotate-left::It starts on the folder you have open, or the one you used last. Starting from a template, your folder choice wins.',
   'fa-pencil::The new entry opens in edit mode.',
  ]),
 'guide-labels': dict(
  summary='Print labels for tubes and boxes on the lab’s label printer, one per row of a pasted table if you like.',
  purpose='Label samples without a separate label program.',
  uses=['Print a row of tube labels from a table.', 'Ask an admin to add a format for a new label size.'],
  details=[
   'fa-print::Open the plus in the top bar and choose Print a label. Pick a format, type up to eight lines and press Print.',
   'fa-brackets-curly::Write a name in curly brackets, for example {sample}, where a value changes: it becomes a box you fill in.',
   'fa-bold::Format each line: size, bold, italic, left, centre or right. The preview shows dashed lines for the margins.',
   'fa-table::To print many labels, paste cells from a spreadsheet and click the columns you want. Each row is one label.',
   'fa-gear::Admins set the printer address, port, resolution and formats in Admin panel, Labels. Without a printer address nothing prints.',
  ]),
 'guide-google-calendar': dict(
  summary='Send your tasks to a Google calendar, show Google calendars beside your projects and keep your choices everywhere.',
  purpose='See your lab tasks next to the rest of your day.',
  uses=['Link a project to its own Google calendar.', 'Hide a project’s tasks from the calendar page.'],
  details=[
   'fa-gear::Calendar settings (the gear in the To-do panel): working hours, weekend days, Google settings, web calendars and a private link.',
   'fa-link::In the Calendars menu of the calendar page, link a project to a Google calendar. Its tasks go there; a calendar chosen for one task wins.',
   'fa-eye::The Calendars menu also chooses which projects and Google calendars are shown.',
   'fa-floppy-disk::Your view, hidden projects and Google choices are saved with your account. The Google sign-in stays in the browser.',
   'fa-list-check::Google Tasks sync is optional and off; an admin must set GOOGLE_SYNC_CSP=true and restart. Tested only with a stand-in for Google.',
  ]),
}

NEW = [
 dict(id='guide-print-pdf', date='2026-11-19', area='Experiments', title='Print and PDF', icon='fa-file-pdf', order=151,
  summary='Print or export an entry, or only the sections you pick, with spreadsheets drawn like the grid on screen.',
  purpose='Hand over a clean copy of an experiment, or just the part someone needs.',
  uses=['Tick the Results in Contents and press PDF.', 'Pick Fit to page width for a wide table on a portrait page.'],
  details=[
   'fa-print::Contents panel header: Print and PDF take the whole entry, or only the sections ticked in Select mode.',
   'fa-file-pdf::The Export menu has the same PDF window (Export as PDF). In the editor, File > Print everything or Print main text.',
   'fa-table::Sheets in print and PDF: Landscape when wide (default), Fit to page width, or Actual size, split across pages.',
   'Sheets print like the live grid: grid lines, labels, fills and bold. Empty trailing rows, columns and hidden ones are left out.',
   'Firefox cannot print one landscape page, so a wide sheet is fitted to portrait there; the PDF file has landscape pages everywhere.',
  ],
  news='New: one Print and one PDF in Contents, and three sheet modes.'),
 dict(id='guide-pins', date='2026-11-19', area='Organise', title='Pins', icon='fa-thumbtack', order=12,
  summary='Pin an entry to keep it at the top of your lists, in its own Pinned group.',
  purpose='Keep the few entries you use every day within reach.',
  uses=['Pin the protocol you open every morning.', 'Pin a running experiment.'],
  details=[
   'fa-thumbtack::Press the pin on an entry, in a list or on its page. A pinned pin is amber and tilted; the same button unpins.',
   'Pinned entries come first, in a Pinned group, in every list layout and on the first page whatever the sorting.',
   'In rows, the pin of an unpinned entry shows when you point at the row.',
   'On Orders, Pinned for all (shared with the team) and Reference (only you) work like pins. Board cards have Pin to top in their ⋮ menu.',
  ],
  news='New: the Pinned group and a clearer pin.'),
 dict(id='guide-admin-settings', date='2026-11-19', area='Settings', title='Team settings for admins', icon='fa-user-gear', order=170,
  summary='The admin Team tab shows settings as boxed cards, with a search box, usage tiles and switches for optional features.',
  purpose='Find and change your team’s settings quickly.',
  uses=['Type “order” in Find a setting.', 'Switch on Bookable resources for the instruments.'],
  details=[
   'fa-user-gear::Open Admin panel > Team. The usage tiles at the top count experiments, resources and users; Generate report exports them.',
   'fa-magnifying-glass::Find a setting: type a word and only the matching settings stay visible. No setting matches says nothing was found.',
   'Settings sit in boxed cards (Experiments, Resources, Orders ...), each with a switch and a short help text.',
   'Features: Tools menu switches (Compounds and Chemical structure editor on; OpenCloning, Inventory off) and Bookable resources (off).',
   'Orders: automatic status steps (Ordered to Collected on a matched shop sheet is on by default) and auto-archive rules.',
  ],
  news='New: boxed cards, a Find a setting box and a Features section.'),
 dict(id='guide-whats-new-popup', date='2026-11-19', area='Settings', title='The What’s new popup', icon='fa-star', order=171,
  summary='A small window after login lists the features you have not seen yet.',
  purpose='Hear about new features once, without hunting for them.',
  uses=['Press “and N more” to open the full What’s new page.', 'Switch it off if you do not want it.'],
  details=[
   'fa-star::Once after you sign in, only when there is something new since you last saw it, the most important first.',
   'Got it, the X, Esc or a click outside all count as seen, in every browser.',
   'fa-link::“and N more” opens the What’s new page; the small i buttons in the app open the same cards one at a time.',
   'fa-toggle-off::“Don’t show these popups” turns it off. Settings > Appearance > What’s new has the switch to turn it back on.',
  ],
  news='New: the popup itself.'),
 dict(id='guide-reminders', date='2026-11-19', area='Tasks', title='Deadline reminders', icon='fa-clock', order=43,
  summary='A small clock chip, top right, counts the tasks due soon and folds away by itself.',
  purpose='Be reminded of deadlines without a banner covering the page.',
  uses=['Click the chip to see what is due.', 'Dismiss all once you have read them.'],
  details=[
   'fa-clock::The chip with a number sits at the top right, under the top bar. It moves aside if something is in the way.',
   'Click it to open the list; a step links to its experiment. It folds by itself after a few seconds, or at once with Esc or Collapse.',
   'Dismiss all clears the list. The chip stays as you left it for the rest of the session.',
   'Set a reminder on a task or step with its deadline: at the deadline or 15 minutes, 1 hour, 1 day or 1 week before.',
  ],
  news='New: a small chip instead of a banner.'),
]

FIXES = {
 'reminder-chip': dict(
  summary='A small clock with a number sits at the top right; click it to see the tasks due soon. It folds away by itself.',
  details=['fa-clock::The reminder no longer covers the page. The chip shows how many tasks are due soon.',
   'Click the chip to open the list. A task from a step links to it. Esc, the title or Collapse fold it again after a few seconds on its own; Dismiss all clears the list.',
   'The chip stays the way you left it for the rest of the session, so it does not open itself on every page.']),
 'print-pdf-selected-sections': dict(
  details=['fa-list-check::In the Contents panel, press Select and tick the sections you want. Print and PDF in the panel header then use only those.',
   'fa-file-pdf::PDF makes a file with only the ticked sections (and the headings above them). The Export as PDF window says when a selection is active. With nothing ticked you get the whole entry.',
   'Spreadsheets print and export like the grid on screen: grid lines, grey row and column labels, fills and bold kept, rows never split over a page, empty filler columns and rows left out.',
   'Plain tables made in the text editor are not spreadsheets and stay ordinary tables.']),
 'side-panel-refresh': dict(
  details=['fa-rotate::Refresh reloads that tab’s own data without reloading the page: the folder tree, the current search, your tasks, the calendar, the headings of the page.',
   'The two buttons no longer move when you switch tabs, and the panel keeps the room for its scroll bar.',
   'In Contents, Print and PDF are in the header, and the select bar at the bottom keeps the count, Copy and Clear.']),
 'spreadsheet-editing': None,  # handled below
}


def main() -> None:
    entries = json.loads(PATH.read_text(encoding='utf-8'))
    by_id = {e['id']: e for e in entries}
    for key, new in TEXT.items():
        e = by_id[key]
        for field, value in new.items():
            e[field] = value
    for key, new in FIXES.items():
        if new:
            by_id[key].update(new)
    se = by_id['spreadsheet-editing']
    se['details'] = [d.replace('up to 50 rows in all', 'up to 400 rows in all') for d in se['details']]
    existing = {e['id'] for e in entries}
    for item in NEW:
        if item['id'] in existing:
            continue
        item.setdefault('featured', False)
        item['guide'] = True
        item.setdefault('screenshots', [])
        item.setdefault('image', '')
        item.setdefault('imageAlt', '')
        item.setdefault('shot', '')
        entries.append(item)
    PATH.write_text(json.dumps(entries, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()

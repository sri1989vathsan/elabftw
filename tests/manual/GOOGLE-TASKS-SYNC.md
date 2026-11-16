# Google Tasks and Calendar sync (optional, per user, browser-side)

Copies a user's open to-dos and unfinished steps into a list called **eLabFTW**
in that user's own Google Tasks. eLabFTW -> Google always; Google -> eLabFTW only
if the user ticks "Also bring ticks, edits and new tasks ... back into eLabFTW".
Google Calendar (web and phone) shows tasks that have a date, so this is also how
to-dos appear in Google Calendar, as all-day tasks that can be ticked.

Code: `src/ts/googleSync.ts` (sign-in, API calls, small panel),
`src/ts/googleTasksSync.ts` (matching and diffing, no network),
`tests/googleTasksSync.test.cjs` (logic tests). The only edits to existing
files are one import + one call in `src/ts/todolist.ts` and one empty `<div>`
in `src/templates/todolist-panel.html`.

## Why it works for a server with no internet

Everything runs in the user's browser. The eLabFTW server makes no calls to
Google and stores no Google credentials or tokens. The browser talks to Google
directly, like the user copying the list by hand.

## Off by default

A server administrator must first switch it on (Sysconfig, "Google Tasks sync").
While the switch is off (the default, migration 108) the to-do panel does not
render the section at all and the browser code never starts. After that,
nothing is loaded from Google and nothing is sent until a user pastes an OAuth
client ID (unless the administrator set one for everyone) and clicks Connect. Until the Content-Security-Policy is changed (below)
Connect fails with a message and the rest of eLabFTW is unaffected.

## What is sent

- Default: the item title, the deadline date, and a line "Deadline: date time".
  Google Tasks only keeps the date, so the time goes in the notes.
- Only if the user ticks "Also send notes, experiment names and links": the
  description and notes, the name of the experiment/resource a step belongs to,
  and a link back to eLabFTW.
- A hidden marker `[elabftw:todo:12]` / `[elabftw:step:34]` at the end of the
  notes, used to match tasks on the next sync.

## Rules

- New open item -> new Google task.
- Edited title, deadline or notes -> Google task updated.
- Item done, archived or deleted in eLabFTW -> Google task marked completed
  (never deleted).
- Two-way box OFF: a task ticked in Google stays ticked and nothing is written
  back to eLabFTW; Google tasks without a marker are never touched.
- Two-way box ON (judged against a snapshot of what was last written to both
  sides, kept in this browser's localStorage):
  - ticked in Google -> the to-do is completed in eLabFTW (steps stay one-way);
  - title or date edited in Google -> written to the to-do (a moved date keeps
    the to-do's time of day); if both sides changed, eLabFTW wins;
  - a task added by hand in the Google list -> a new to-do (plain text, date
    becomes 09:00, at most 50 per sync) and the marker is written back to Google;
  - a task deleted in Google is not recreated; the to-do stays in eLabFTW;
  - a to-do reopened in eLabFTW is not completed again by an old Google tick.
  Nothing is ever deleted in eLabFTW. The only eLabFTW calls the import makes
  are: create a to-do, change its title/deadline, complete it.
- Syncs: when the to-do list changes (3 s after), every 5 minutes while a page
  is open, when a tab becomes visible again (at most once a minute), and on
  "Sync now". Nothing syncs while no eLabFTW tab is open.
- Google access lasts about an hour. When it has gone the panel asks Google for
  a new one without a window; that works when Google can answer silently and
  may otherwise show "Connect again" (one click).

## Admin setup (once)

1. Google Cloud console: create a project, enable the **Google Tasks API**.
2. OAuth consent screen: for an ETH Google Workspace use type **Internal** so no
   Google verification is needed and only organization accounts can connect.
   Scope: `https://www.googleapis.com/auth/tasks`.
3. Credentials -> OAuth client ID -> **Web application**. Under *Authorized
   JavaScript origins* add exactly the address users open eLabFTW at
   (`https://elab.yourgroup.ethz.ch`, or `http://localhost:PORT` for a local test).
   Google rejects bare IP addresses and names like `.local`.
4. In Sysconfig, section "Google Tasks sync": tick *Offer Google Tasks sync in the
   to-do panel*. Optionally enter the client ID there (it is not secret) so users
   do not have to; otherwise each user pastes it into the panel once per browser.
5. Allow Google in the Content-Security-Policy. In
   `containers/elabimg/nginx/common.conf`, the default policy (the
   `Content-Security-Policy` line near `Strict-Transport-Security`) needs:

   - `script-src` + ` https://accounts.google.com/gsi/client`
   - `connect-src` + ` https://tasks.googleapis.com https://accounts.google.com/gsi/`
   - `frame-src https://accounts.google.com/gsi/` (add the directive)

   This is deliberately NOT in the committed default: widening the policy is a
   decision for whoever runs the server, and an organization's IT security team
   will want to review it. It means the eLabFTW page may load Google's sign-in
   script and connect to Google's APIs.

## Things a security review will ask

- Data leaves the institution: titles (and dates) of to-dos and steps reach
  Google and then sync to the user's other Google devices. Use an organization
  Google account, not a personal one, and check the data-protection rules for
  what may appear in task titles.
- With the two-way box on, whoever controls the Google account (or a shared
  list) can create, retitle, redate and complete that user's to-dos. Imported
  text is plain text (the server also strips tags); nothing else in eLabFTW is
  reachable by the import code.
- A Google access token (Tasks scope only, about 1 hour) is kept in
  `sessionStorage` for the tab, so it survives page changes but not closing the
  tab. A script injected into an eLabFTW page could read it; that is the
  reason for the narrow scope and short life.
- Disconnect revokes the token at Google and forgets it. Revoking the app in
  the Google account does the same.
- Deleting something in eLabFTW does not delete copies already in Google; it
  marks them completed.

## Manual test rows

| # | Steps | Expect |
|---|-------|--------|
| G0 | Switch off in Sysconfig (default); open the To-do panel | No Google section; no request to Google; sync code does nothing even if a client ID and "enabled" are left in the browser |
| G0b | Switch on, client ID empty | Section appears with the client ID box |
| G0c | Switch on, client ID set in Sysconfig | Section appears without a client ID box; Connect uses that ID |
| G1 | Open To-do panel with no client ID | Section is open; Connect shows "Enter a Google client ID first." |
| G2 | Enter client ID, Connect while CSP blocks Google | Red message about the Content-Security-Policy; nothing else breaks |
| G3 | Allow Google, Connect, sign in | List "eLabFTW" appears in Google Tasks with all open to-dos and steps |
| G4 | Add / rename / set deadline on a to-do | Within ~5 s Google shows it; deadline is the right date, time is in notes |
| G5 | Complete a to-do in eLabFTW | Google task becomes completed |
| G6 | Two-way box off: tick a task in Google | Stays ticked; eLabFTW item unchanged |
| G7 | Tick "include notes..." | Notes, experiment name and link appear after next sync |
| G8 | Two-way box off: create a Google task by hand in the same list | Never modified or completed |
| G9 | Disconnect | Token gone; eLabFTW stops calling Google; tasks already in Google stay |
| G10 | Close tab, reopen | Renews quietly or shows "Connect again" (token was per tab) |
| G11 | Two-way on: tick, rename, move a date, add and delete tasks in Google | to-do completed / renamed / re-dated (time kept) / created with marker / not recreated |
| G12 | Two-way on: complete then reopen a to-do in eLabFTW | Google task completed; reopening is not undone |

`tests/manual/google-sync-check.js` runs G3-G5 and G11-G12 and the token renewal
against `tests/manual/google-stub.js` (a fake Google that needs no account or
internet). It does NOT prove anything about real Google: that needs G3 with a
real OAuth client ID.

## Google Calendar (added with task durations)

Each user chooses, in the panel, where the to-dos go: **Google Tasks** (as above), **Google Calendar**, or both.
Settings are kept per eLabFTW account in the browser (`googleSync*:<userid>`); Google Tasks and Calendar use the
same client ID and the same Connect button, and the permissions asked from Google follow the choice:

- Tasks: `https://www.googleapis.com/auth/tasks`
- Calendar (only when the to-dos go there, or calendars are shown on the calendar page):
  `https://www.googleapis.com/auth/calendar.events` and `https://www.googleapis.com/auth/calendar.calendarlist.readonly`

When the choice changes the panel says "Connect again" (one click) so Google can ask for the new permission.
Admin setup: enable the **Google Calendar API** too, add the two scopes to the consent screen, and in the
Content-Security-Policy add ` https://www.googleapis.com` to `connect-src` (next to `https://tasks.googleapis.com`).

Where to link Google: in the to-do panel, open the **By date** tab; the Google section is under the private calendar link
(choose Google Tasks / Google Calendar, then **Connect**). The calendar page also has a **Calendars** dropdown in its toolbar
with a **Connect Google** button, and the calendar and project choices (tasks are shown per project, Google per calendar).
A task has a begin and an end time (the end is kept as its length); the end is set in the task editor or by dragging the lower
edge on the calendar page.

How a task is written: a task with a deadline is an event that starts at the deadline and lasts the duration of the task
(30 minutes unless changed in the task editor, or by dragging its lower edge on the calendar page), with a popup reminder
of the task's reminder, a link back to the task in the description, and a hidden private property `elabftwTask=<id>`
that matches the event on the next sync. Notes are sent only when "Also send notes" is ticked.

Rules (same ideas as for Google Tasks; judged against a snapshot of what was written last time):

- eLabFTW -> Google always: new task -> new event; changed title, deadline or duration -> event patched; a task that is done
  gets a tick in front of its event title (once), the event is kept.
- Two-way box on: an event that was retitled, moved or made longer or shorter in Google changes the task (title, deadline,
  duration). If both sides changed, eLabFTW wins. Nothing is ever deleted in eLabFTW.
- An event deleted in Google is not made again until the task itself changes.
- "New events of that calendar become to-dos" (two-way only, off by default): a future event without the property, not
  recurring and not all-day, becomes a to-do with its length as the duration, and the property is written back to the event.
- Only tasks of the next 12 months and the last 30 days are looked at.
- Which calendars are shown on the eLabFTW calendar page is chosen with the eye boxes in the panel (the primary calendar
  by default); their events are drawn next to the tasks, read only. The events that are tasks are not drawn twice.

| # | Steps | Expect |
|---|-------|--------|
| C1 | Choose Google Calendar, Connect | A calendar list appears; the dot picks the calendar that receives the to-dos |
| C2 | Create a task with a date and a duration of 90 minutes | Event of 90 minutes at that time, with a reminder and a link back |
| C3 | Change the duration in the task editor / drag the block on the calendar page | The event changes on the next sync |
| C4 | Two-way on: move or lengthen the event in Google | Task deadline and duration follow |
| C5 | Delete the event in Google | Not made again; changing the task makes it again |
| C6 | Complete the task | Event title gets a tick in front |
| C7 | Tick the eye of another calendar | Its events appear on the calendar page in its colour, without the tasks twice |
| C8 | Choose "Both" | Tasks list and calendar are both written |

`tests/googleCalendarSync.test.cjs` covers the logic; `tests/manual/google-calendar-check.js` runs C1-C7 against
`tests/manual/google-stub.js`. Real Google has not been tried.

## Calendars from a web address (.ics)

The **Calendars** dropdown of the calendar page can also show any calendar that has an address (a Google "Secret address in
iCal format", Outlook, a university, ...). The address is read by the browser (the server has no internet), kept in this browser
for this account only, and read again every 15 minutes while the page is open. Repeating events, all-day events and time zones
are understood (`src/ts/icalFeed.ts`, `tests/icalFeed.test.cjs`). Two things must allow it:

- the site must send CORS headers (Google's secret address does not, most university and Outlook feeds do not either: then the
  dropdown says the address could not be read);
- the Content-Security-Policy `connect-src` must contain the host (or `https:`).

`tests/manual/test-feed.ics` is a feed for trying it on the dev proxy (`/__tests/test-feed.ics`, same origin so no CORS).

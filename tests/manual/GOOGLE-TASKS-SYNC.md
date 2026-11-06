# Google Tasks sync (optional, per user, browser-side)

Copies a user's open to-dos and unfinished steps into a list called **eLabFTW**
in that user's own Google Tasks. One way: eLabFTW -> Google.

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

Nothing is loaded from Google and nothing is sent until a user pastes an OAuth
client ID and clicks Connect. Until the Content-Security-Policy is changed (below)
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
- A task the user ticked in Google stays ticked, even if the item is still open
  in eLabFTW (nothing is reopened, nothing is written back to eLabFTW).
- Google tasks without a marker (made by hand) are never touched.
- Syncs: when the to-do list changes (3 s after), every 5 minutes while a page
  is open, and on "Sync now".

## Admin setup (once)

1. Google Cloud console: create a project, enable the **Google Tasks API**.
2. OAuth consent screen: for an ETH Google Workspace use type **Internal** so no
   Google verification is needed and only organization accounts can connect.
   Scope: `https://www.googleapis.com/auth/tasks`.
3. Credentials -> OAuth client ID -> **Web application**. Under *Authorized
   JavaScript origins* add exactly the address users open eLabFTW at
   (`https://elab.yourgroup.ethz.ch`, or `http://localhost:PORT` for a local test).
   Google rejects bare IP addresses and names like `.local`.
4. Give users the client ID (it is not secret). Each user pastes it into the
   Google Tasks panel in the to-do sidebar, once per browser.
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
| G1 | Open To-do panel with no client ID | Section is open; Connect shows "Enter a Google client ID first." |
| G2 | Enter client ID, Connect while CSP blocks Google | Red message about the Content-Security-Policy; nothing else breaks |
| G3 | Allow Google, Connect, sign in | List "eLabFTW" appears in Google Tasks with all open to-dos and steps |
| G4 | Add / rename / set deadline on a to-do | Within ~5 s Google shows it; deadline is the right date, time is in notes |
| G5 | Complete a to-do in eLabFTW | Google task becomes completed |
| G6 | Tick a task in Google | Stays ticked; eLabFTW item unchanged |
| G7 | Tick "include notes..." | Notes, experiment name and link appear after next sync |
| G8 | Create a Google task by hand in the same list | Never modified or completed |
| G9 | Disconnect | Token gone; eLabFTW stops calling Google; tasks already in Google stay |
| G10 | Close tab, reopen | Shows "Connect again" (token was per tab) |

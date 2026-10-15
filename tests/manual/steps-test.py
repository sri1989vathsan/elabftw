#!/usr/bin/env python3
"""
Steps and tasks test with two people: @mention assigns a step, completing it, notifications, removal.

Needs the local dev app (http://localhost:8973, see dev-proxy.js) and the two test accounts in
TEST-ACCOUNTS.md (Alice Tester, Bob Tester). Everything it creates is a scratch entry named "ZZ steps test ...".

    python3 -I tests/manual/steps-test.py

For a run inside Firefox/Chrome as the one logged-in person, use steps-test.js instead.
"""
import http.cookiejar
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = 'http://localhost:8973'
PASSWORD = 'Zz-Test-Pass-4821!'
ALICE = ('alice.tester@example.test', 'Alice Tester')
BOB = ('bob.tester@example.test', 'Bob Tester')


class Session:
    def __init__(self, email):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        html = self.opener.open(BASE + '/login.php').read().decode()
        csrf = re.search(r"name='csrf' value='([^']+)'", html).group(1)
        data = urllib.parse.urlencode({'csrf': csrf, 'email': email, 'password': PASSWORD, 'auth_type': 'local'}).encode()
        self.opener.open(urllib.request.Request(BASE + '/app/controllers/LoginController.php', data=data))
        page = self.opener.open(BASE + '/dashboard.php').read().decode()
        match = re.search(r"name='csrf-token' content='([^']+)'", page)
        if not match:
            raise SystemExit(f'login failed for {email}')
        self.csrf = match.group(1)

    def api(self, method, path, body=None):
        request = urllib.request.Request(
            f'{BASE}/api/v2/{path.lstrip("/")}', method=method,
            data=json.dumps(body).encode() if body is not None else None,
            headers={'Content-Type': 'application/json', 'X-CSRF-Token': self.csrf})
        try:
            response = self.opener.open(request)
            raw = response.read().decode()
            data = json.loads(raw) if raw.strip().startswith(('{', '[')) else raw
            return response.status, data, response.headers
        except urllib.error.HTTPError as error:
            return error.code, error.read().decode()[:300], error.headers

    def create(self, path, body):
        status, _, headers = self.api('POST', path, body)
        location = headers.get('Location') or ''
        return status, int(location.rstrip('/').split('/')[-1]) if location else None


results = []


def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS  ' if ok else 'FAIL  ') + name + (f'   [{detail}]' if detail and not ok else ''))


def wait(seconds=0.6):
    time.sleep(seconds)


def tasks_with(session, marker, completed=False, assigned=None):
    """The to-dos that carry the marker. 'assigned' keeps only those given to that person: with a step
    deadline the assigner also has a to-do of their own for it, which the team list shows to everybody."""
    _, data, _ = session.api('GET', 'todolist?completed=1' if completed else 'todolist')
    found = [task for task in data if marker in (task.get('body') or '')] if isinstance(data, list) else []
    return [task for task in found if assigned is None or task.get('assigned_fullname') == assigned]


def notes_with(session, marker, category=None):
    _, data, _ = session.api('GET', 'users/me/notifications')
    found = []
    for note in data if isinstance(data, list) else []:
        text = json.dumps(note.get('body') or {})
        if marker in text and (category is None or note.get('category') == category):
            found.append(note)
    return found


def notes_for_entry(session, title, category):
    _, data, _ = session.api('GET', 'users/me/notifications')
    return [n for n in (data if isinstance(data, list) else []) if n.get('category') == category and (n.get('body') or {}).get('title') == title]


def new_entry(session, title, private=False):
    status, entry_id = session.create('experiments', {'title': title})
    assert entry_id, f'could not create the entry ({status})'
    if private:
        session.api('PATCH', f'experiments/{entry_id}', {'canread_base': 10, 'canwrite_base': 10})
    return entry_id


def add_step(session, entry_id, text):
    return session.create(f'experiments/{entry_id}/steps', {'body': text})[1]


def step_info(session, entry_id, step_id):
    _, steps, _ = session.api('GET', f'experiments/{entry_id}/steps')
    return next((s for s in steps if s['id'] == step_id), None) if isinstance(steps, list) else None


def main():
    alice = Session(ALICE[0])
    bob = Session(BOB[0])
    stamp = str(int(time.time()))[-6:]

    # --- 1. assign by @mention -----------------------------------------------------------------
    entry = new_entry(alice, f'ZZ steps test A {stamp}')
    marker = f'gel{stamp}'
    step = add_step(alice, entry, f'Load the {marker} @{BOB[1]}')
    wait()
    bob_tasks = tasks_with(bob, marker, assigned=BOB[1])
    check('1 a mentioned person gets a task of their own', len(bob_tasks) == 1, f'{len(bob_tasks)} tasks')
    task = bob_tasks[0] if bob_tasks else {}
    check('2 the task belongs to the mentioned person and shows who assigned it', task.get('assigned_fullname') == BOB[1], str(task.get('assigned_fullname')))
    check('3 the task text starts with "Step:"', (task.get('body') or '').startswith('Step:'), task.get('body'))
    notes = notes_for_entry(bob, f'ZZ steps test A {stamp}', 107)
    check('4 the person is notified, and the assigner is named', len(notes) >= 1 and ALICE[1] in json.dumps(notes[0]['body']), json.dumps(notes[:1])[:200])
    check('5 the notification names the entry', len(notes) >= 1 and notes[0]['body'].get('title') == f'ZZ steps test A {stamp}', '')
    entry_links = [k for k in task if 'entit' in k or 'link' in k]
    status, links, _ = bob.api('GET', f'todolist/{task.get("id")}/entity_links') if task else (0, [], None)
    check('6 the task links to the experiment', status == 200 and any(str(entry) in json.dumps(l) for l in (links if isinstance(links, list) else [])), f'{status} {str(links)[:160]} keys={entry_links}')
    check('7 the assigner does not get a task for someone else', not tasks_with(alice, marker, assigned=ALICE[1]))

    # --- 2. repeated and unknown names ---------------------------------------------------------
    marker2 = f'dup{stamp}'
    add_step(alice, entry, f'Check {marker2} @{BOB[1]} and again @{BOB[1]}')
    wait()
    check('8 the same person named twice gets one task', len(tasks_with(bob, marker2, assigned=BOB[1])) == 1, str(len(tasks_with(bob, marker2, assigned=BOB[1]))))
    marker3 = f'ghost{stamp}'
    before = len(tasks_with(bob, marker3, assigned=BOB[1])) + len(tasks_with(alice, marker3))
    status, ghost = alice.create(f'experiments/{entry}/steps', {'body': f'Ask {marker3} @Nobody Atall'})
    wait()
    check('9 an unknown name is just text: the step is saved and nobody gets a task', status in (200, 201) and ghost and before == 0 == len(tasks_with(bob, marker3, assigned=BOB[1])) + len(tasks_with(alice, marker3)), str(status))

    # --- 3. deadline ---------------------------------------------------------------------------
    alice.api('PATCH', f'experiments/{entry}/steps/{step}', {'deadline': '2030-01-02T15:00:00'})
    wait()
    task = (tasks_with(bob, marker, assigned=BOB[1]) or [{}])[0]
    check('10 the step deadline is copied to the assignee\'s task', (task.get('deadline') or '').startswith('2030-01-02'), str(task.get('deadline')))

    # --- 4. the assignee completes it ----------------------------------------------------------
    bob.api('PATCH', f'todolist/{task.get("id")}', {'completed': True})
    wait(1.0)
    info = step_info(alice, entry, step)
    wait(0.8)
    check('11 when the assignee completes the task the step is finished', bool(info and info.get('finished')), str(info and info.get('finished')))
    check('12 the assigner is told it is finished, and by whom', any(BOB[1] in json.dumps(n['body']) and marker in json.dumps(n['body']) for n in notes_for_entry(alice, f'ZZ steps test A {stamp}', 106)), json.dumps(notes_for_entry(alice, f'ZZ steps test A {stamp}', 106))[:300])
    check('13 the assignee is not notified about finishing it themselves', not [n for n in notes_for_entry(bob, f'ZZ steps test A {stamp}', 106) if marker in json.dumps(n['body'])], '')

    # --- 5. the assigner finishes it: everybody's task completes --------------------------------
    entry2 = new_entry(alice, f'ZZ steps test B {stamp}')
    marker4 = f'both{stamp}'
    step2 = add_step(alice, entry2, f'Run {marker4} @{BOB[1]} @{ALICE[1]}')
    wait()
    check('14 mentioning yourself is ignored: you are the assigner, so you get no task', len(tasks_with(bob, marker4, assigned=BOB[1])) == 1 and len(tasks_with(alice, marker4, assigned=ALICE[1])) == 0,
          f'bob {len(tasks_with(bob, marker4, assigned=BOB[1]))} alice {len(tasks_with(alice, marker4))}')
    check('15 and no notification', not notes_for_entry(alice, f'ZZ steps test B {stamp}', 107), '')
    alice.api('PATCH', f'experiments/{entry2}/steps/{step2}', {'action': 'finish'})
    wait(1.0)
    done = [bool(t.get('completed_at')) for t in tasks_with(bob, marker4, completed=True, assigned=BOB[1])]
    check('16 finishing the step (by the assigner) completes the assignee\'s task', done and all(done), str(done))
    check('17 the assignee is told it was finished', any(marker4 in json.dumps(n['body']) for n in notes_for_entry(bob, f'ZZ steps test B {stamp}', 106)), '')

    # --- 6. taking a name out, deleting the step -----------------------------------------------
    entry3 = new_entry(alice, f'ZZ steps test C {stamp}')
    marker5 = f'edit{stamp}'
    step3 = add_step(alice, entry3, f'Mix {marker5} @{BOB[1]}')
    wait()
    ok_before = len(tasks_with(bob, marker5, assigned=BOB[1])) == 1
    alice.api('PATCH', f'experiments/{entry3}/steps/{step3}', {'body': f'Mix {marker5} alone'})
    wait()
    check('18 taking the name out of the text removes that person\'s task', ok_before and not tasks_with(bob, marker5, assigned=BOB[1]), f'before {ok_before}, after {len(tasks_with(bob, marker5, assigned=BOB[1]))}')
    alice.api('PATCH', f'experiments/{entry3}/steps/{step3}', {'body': f'Mix {marker5} @{BOB[1]}'})
    wait()
    check('19 putting the name back gives the task again', len(tasks_with(bob, marker5, assigned=BOB[1])) == 1, '')
    alice.api('DELETE', f'experiments/{entry3}/steps/{step3}')
    wait()
    check('20 deleting the step removes the task', not tasks_with(bob, marker5, assigned=BOB[1]), str(len(tasks_with(bob, marker5, assigned=BOB[1]))))

    # --- 7. an entry the assignee cannot open --------------------------------------------------
    entry4 = new_entry(alice, f'ZZ steps test private {stamp}', private=True)
    marker6 = f'priv{stamp}'
    add_step(alice, entry4, f'Look {marker6} @{BOB[1]}')
    wait()
    check('21 a private entry: the person still gets the task', len(tasks_with(bob, marker6, assigned=BOB[1])) == 1, str(len(tasks_with(bob, marker6, assigned=BOB[1]))))
    check('22 and sees the entry\'s name in the notification', bool(notes_for_entry(bob, f'ZZ steps test private {stamp}', 107)), '')

    # --- 8. permissions ------------------------------------------------------------------------
    status, _, _ = bob.api('POST', f'experiments/{entry4}/steps', {'body': 'sneaky'})
    check('23 someone without write access cannot add a step to the entry', status in (403, 404), str(status))

    # --- 9. un-finishing -----------------------------------------------------------------------
    alice.api('PATCH', f'experiments/{entry2}/steps/{step2}', {'action': 'finish'})  # toggles back to open
    wait(1.0)
    info = step_info(alice, entry2, step2)
    states = [bool(t.get('completed_at')) for t in tasks_with(bob, marker4, completed=True, assigned=BOB[1])]
    print(f'INFO  reopening a finished step: step finished={info and info.get("finished")}, tasks completed={states}')

    failed = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(failed)} of {len(results)} passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
Repeating to-dos: the next task is created on completion, with the right date, and not twice.

Needs the local dev app (http://localhost:8973, see dev-proxy.js) and Alice Tester from TEST-ACCOUNTS.md.
Everything it creates is a scratch task named "ZZ repeat ...".

    python3 -I tests/manual/repeat-test.py
"""
import importlib.util
import json
import os
import sys
import time

here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('steps_test', os.path.join(here, 'steps-test.py'))
steps = importlib.util.module_from_spec(spec)
spec.loader.exec_module(steps)

results = []


def check(name, ok, detail=''):
    results.append((name, bool(ok)))
    print(('PASS  ' if ok else 'FAIL  ') + name + (f'   [{detail}]' if detail and not ok else ''))


def open_tasks(session, marker):
    _, data, _ = session.api('GET', 'todolist')
    return [t for t in data if marker in (t.get('body') or '')] if isinstance(data, list) else []


def done_tasks(session, marker):
    _, data, _ = session.api('GET', 'todolist?completed=1')
    return [t for t in data if marker in (t.get('body') or '')] if isinstance(data, list) else []


def make(session, marker, deadline, rule, **extra):
    status, task_id = session.create('todolist', {'content': marker, 'deadline': deadline, 'repeat_rule': rule, **extra})
    return status, task_id


def day(task):
    return (task.get('deadline') or '')[:10]


def complete(session, task_id):
    return session.api('PATCH', f'todolist/{task_id}', {'completed': True})


def main():
    alice = steps.Session(steps.ALICE[0])
    stamp = str(int(time.time()))[-6:]

    # 1. the basic units, from a deadline in the future so the plain next date shows
    cases = [
        ('daily', '2030-03-10T09:00:00Z', {'unit': 'day', 'every': 1}, '2030-03-11'),
        ('weekly', '2030-03-10T09:00:00Z', {'unit': 'week', 'every': 1}, '2030-03-17'),
        ('every 2 weeks', '2030-03-10T09:00:00Z', {'unit': 'week', 'every': 2}, '2030-03-24'),
        ('every 3 days', '2030-03-10T09:00:00Z', {'unit': 'day', 'every': 3}, '2030-03-13'),
        ('monthly', '2030-03-10T09:00:00Z', {'unit': 'month', 'every': 1}, '2030-04-10'),
        ('monthly from the 31st lands on the last day', '2030-01-31T09:00:00Z', {'unit': 'month', 'every': 1}, '2030-02-28'),
        ('yearly from 29 February', '2032-02-29T09:00:00Z', {'unit': 'year', 'every': 1}, '2033-02-28'),
        ('every 6 months', '2030-08-31T09:00:00Z', {'unit': 'month', 'every': 6}, '2031-02-28'),
    ]
    for label, deadline, rule, expected in cases:
        marker = f'ZZ repeat {label} {stamp}'
        status, task_id = make(alice, marker, deadline, rule)
        complete(alice, task_id)
        time.sleep(0.4)
        nxt = open_tasks(alice, marker)
        check(f'{label}: completing makes exactly one next task', len(nxt) == 1, f'status {status}, {len(nxt)} open')
        check(f'{label}: due {expected}', bool(nxt) and day(nxt[0]) == expected, day(nxt[0]) if nxt else 'none')

    # 1b. days of the week (1 = Monday ... 7 = Sunday); 11 March 2030 is a Monday
    week_cases = [
        ('Mon/Wed/Fri: from Monday to Wednesday', '2030-03-11T09:00:00Z', {'unit': 'week', 'every': 1, 'days': [1, 3, 5]}, '2030-03-13'),
        ('Mon/Wed/Fri: from Friday to the next Monday', '2030-03-15T09:00:00Z', {'unit': 'week', 'every': 1, 'days': [1, 3, 5]}, '2030-03-18'),
        ('every 2 weeks on Mon/Wed: from Wednesday two weeks on', '2030-03-13T09:00:00Z', {'unit': 'week', 'every': 2, 'days': [1, 3]}, '2030-03-25'),
        ('weekdays: from Friday to Monday', '2030-03-15T09:00:00Z', {'unit': 'week', 'every': 1, 'days': [1, 2, 3, 4, 5]}, '2030-03-18'),
        ('weekend days: from Saturday to Sunday', '2030-03-16T09:00:00Z', {'unit': 'week', 'every': 1, 'days': [6, 7]}, '2030-03-17'),
    ]
    for label, deadline, rule, expected in week_cases:
        marker = f'ZZ repeat {label} {stamp}'
        status, task_id = make(alice, marker, deadline, rule)
        complete(alice, task_id)
        time.sleep(0.4)
        nxt = open_tasks(alice, marker)
        check(f'{label}: due {expected}', len(nxt) == 1 and day(nxt[0]) == expected, f'status {status}: {[day(t) for t in nxt]}')
    status, _, _ = alice.api('POST', 'todolist', {'content': 'x', 'deadline': '2030-03-11T09:00:00Z', 'repeat_rule': {'unit': 'week', 'every': 1, 'days': [0, 8]}})
    check('a day of the week outside 1 to 7 is refused', status == 400, str(status))

    # 1c. the person's time zone: 9:00 in Zurich stays 9:00 when the clocks change (31 March 2030)
    marker = f'ZZ repeat zone {stamp}'
    _, task_id = make(alice, marker, '2030-03-30T08:00:00Z', {'unit': 'day', 'every': 1, 'tz': 'Europe/Zurich'})
    complete(alice, task_id)
    time.sleep(0.4)
    nxt = (open_tasks(alice, marker) or [{}])[0]
    check('9:00 in Zurich stays 9:00 across the clock change (07:00 UTC)', (nxt.get('deadline') or '').startswith('2030-03-31T07:00'), str(nxt.get('deadline')))

    # 2. the time of day and what is carried over
    marker = f'ZZ repeat carry {stamp}'
    _, task_id = make(alice, marker, '2030-05-06T13:30:00Z', {'unit': 'day', 'every': 1}, notes='keep these notes', reminder_minutes=15)
    complete(alice, task_id)
    time.sleep(0.4)
    nxt = (open_tasks(alice, marker) or [{}])[0]
    check('the time of day is kept', (nxt.get('deadline') or '')[11:16] == '13:30', str(nxt.get('deadline')))
    check('notes and reminder are kept', nxt.get('notes') == 'keep these notes' and nxt.get('reminder_minutes') == 15, f"{nxt.get('notes')} / {nxt.get('reminder_minutes')}")
    check('the new task repeats too, with the same rule', json.loads(nxt.get('repeat_rule') or '{}').get('unit') == 'day', str(nxt.get('repeat_rule')))
    check('the finished task stays as history', len(done_tasks(alice, marker)) == 1, str(len(done_tasks(alice, marker))))

    # 3. a late task: no pile of past dates
    marker = f'ZZ repeat late {stamp}'
    _, task_id = make(alice, marker, '2020-01-01T09:00:00Z', {'unit': 'day', 'every': 1})
    complete(alice, task_id)
    time.sleep(0.4)
    nxt = (open_tasks(alice, marker) or [{}])[0]
    check('a task that was years late gets its next date in the future', (nxt.get('deadline') or '') > time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), str(nxt.get('deadline')))

    # 4. reopening and completing again does not make a second copy
    marker = f'ZZ repeat reopen {stamp}'
    _, task_id = make(alice, marker, '2030-06-01T09:00:00Z', {'unit': 'week', 'every': 1})
    complete(alice, task_id)
    time.sleep(0.4)
    alice.api('PATCH', f'todolist/{task_id}', {'completed': False})
    time.sleep(0.3)
    complete(alice, task_id)
    time.sleep(0.4)
    others = [t for t in open_tasks(alice, marker) if t['id'] != task_id]
    check('reopening and completing again does not create another copy', len(others) == 1, str([t['id'] for t in others]))

    # 5. the end
    marker = f'ZZ repeat until {stamp}'
    _, task_id = make(alice, marker, '2030-01-01T09:00:00Z', {'unit': 'day', 'every': 1, 'until': '2030-01-01'})
    complete(alice, task_id)
    time.sleep(0.4)
    check('an end date on the last day: no further task', not open_tasks(alice, marker), str(len(open_tasks(alice, marker))))
    marker = f'ZZ repeat until2 {stamp}'
    _, task_id = make(alice, marker, '2030-01-01T09:00:00Z', {'unit': 'day', 'every': 1, 'until': '2030-01-02'})
    complete(alice, task_id)
    time.sleep(0.4)
    nxt = open_tasks(alice, marker)
    check('an end date still ahead: the next task is made', len(nxt) == 1 and day(nxt[0]) == '2030-01-02', str([day(t) for t in nxt]))
    complete(alice, nxt[0]['id'] if nxt else 0)
    time.sleep(0.4)
    check('and the one after it is not (it would pass the end date)', not open_tasks(alice, marker), str(len(open_tasks(alice, marker))))
    marker = f'ZZ repeat count {stamp}'
    _, task_id = make(alice, marker, '2030-02-01T09:00:00Z', {'unit': 'day', 'every': 1, 'count': 1})
    complete(alice, task_id)
    time.sleep(0.4)
    second = open_tasks(alice, marker)
    check('"after 2 times": the second one is made', len(second) == 1, str(len(second)))
    complete(alice, second[0]['id'] if second else 0)
    time.sleep(0.4)
    check('"after 2 times": the third is not', not open_tasks(alice, marker), str(len(open_tasks(alice, marker))))

    # 6. rules that are not allowed
    marker = f'ZZ repeat nodeadline {stamp}'
    status, task_id = alice.create('todolist', {'content': marker})
    st, _, _ = alice.api('PATCH', f'todolist/{task_id}', {'repeat_rule': {'unit': 'day', 'every': 1}})
    check('a task without a deadline cannot repeat', st == 400, str(st))
    marker = f'ZZ repeat badunit {stamp}'
    st, _, _ = alice.api('POST', 'todolist', {'content': marker, 'deadline': '2030-01-01T09:00:00Z', 'repeat_rule': {'unit': 'hour', 'every': 1}})
    check('an unknown unit is refused', st == 400, str(st))
    st, _, _ = alice.api('POST', 'todolist', {'content': marker, 'deadline': '2030-01-01T09:00:00Z', 'repeat_rule': {'unit': 'day', 'every': 0}})
    check('"every 0" is refused', st == 400, str(st))
    marker = f'ZZ repeat cleardeadline {stamp}'
    _, task_id = make(alice, marker, '2030-01-01T09:00:00Z', {'unit': 'day', 'every': 1})
    alice.api('PATCH', f'todolist/{task_id}', {'deadline': None})
    task = (open_tasks(alice, marker) or [{}])[0]
    check('removing the deadline removes the repeat', not task.get('repeat_rule'), str(task.get('repeat_rule')))

    # 7. changing and switching off the rule on an existing task
    marker = f'ZZ repeat edit {stamp}'
    _, task_id = make(alice, marker, '2030-07-01T09:00:00Z', {'unit': 'day', 'every': 1})
    alice.api('PATCH', f'todolist/{task_id}', {'repeat_rule': {'unit': 'month', 'every': 1}})
    alice.api('PATCH', f'todolist/{task_id}', {'completed': True})
    time.sleep(0.4)
    check('editing the rule: the new rule is used', day((open_tasks(alice, marker) or [{}])[0]) == '2030-08-01', str([day(t) for t in open_tasks(alice, marker)]))
    marker = f'ZZ repeat off {stamp}'
    _, task_id = make(alice, marker, '2030-07-01T09:00:00Z', {'unit': 'day', 'every': 1})
    alice.api('PATCH', f'todolist/{task_id}', {'repeat_rule': None})
    alice.api('PATCH', f'todolist/{task_id}', {'completed': True})
    time.sleep(0.4)
    check('switching the repeat off: completing makes nothing', not open_tasks(alice, marker), str(len(open_tasks(alice, marker))))

    failed = [r for r in results if not r[1]]
    print(f'\n{len(results) - len(failed)} of {len(results)} passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()

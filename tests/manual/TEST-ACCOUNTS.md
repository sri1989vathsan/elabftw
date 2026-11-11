# Local test accounts (dev instance only)

Created on 2026-10-14 for testing steps assigned by @mention, comment mentions and notifications
with more than one person. They exist only in the local development database.

| Name | Email | Password |
| --- | --- | --- |
| Alice Tester | alice.tester@example.test | Zz-Test-Pass-4821! |
| Bob Tester | bob.tester@example.test | Zz-Test-Pass-4821! |

Both are plain members of the default team. Passwords were set directly in the database
(`password_hash`), since the API does not allow changing another user's password.

## Accounts of the Database stack (`codex/inventory`, https://127.0.0.1:3152)

Added 2026-11-11 for testing personal modules and label printing. The password of both is `Zz-test-pass-1`
(set directly in the database). They are plain members of the default team; make one an admin for a test
with `UPDATE users2teams SET is_admin = 1 WHERE users_id = <id>` and set it back afterwards.

| Name | Email | userid |
| --- | --- | --- |
| Zz Tester | zz.tester@example.test | 90001 |
| Bob Zz | zz.bob@example.test | 90002 |

The login of `tester@example.test` (userid 1, the sysadmin) is yours: its password is not stored anywhere I can read.
Alice and Bob Tester above belong to another test database and do not exist on this stack.

# Local test accounts (dev instance only)

Created on 2026-10-14 for testing steps assigned by @mention, comment mentions and notifications
with more than one person. They exist only in the local development database.

| Name | Email | Password |
| --- | --- | --- |
| Alice Tester | alice.tester@example.test | Zz-Test-Pass-4821! |
| Bob Tester | bob.tester@example.test | Zz-Test-Pass-4821! |

Both are plain members of the default team. Passwords were set directly in the database
(`password_hash`), since the API does not allow changing another user's password.

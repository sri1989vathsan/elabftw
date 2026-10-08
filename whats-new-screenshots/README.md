# What's new screenshots

1. Take a screenshot (Cmd+Shift+4) of the feature, using demo data only.
2. Save it in `inbox/` named after the entry, for example `activity-calendar.png`.
   Entry ids: see `src/whats-new.json` (`id` of each entry).
3. Tell Claude the files are there. It looks at each one, fills in `regions.json`
   (crop, boxes to blank out, where to outline) and runs `process.py`.

The processed pictures go to `web/assets/images/whats-new/` and are picked up by the
What's new page straight away, no rebuild needed. `inbox/` is not committed.

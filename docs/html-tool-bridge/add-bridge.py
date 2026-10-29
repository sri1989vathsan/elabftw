#!/usr/bin/env python3
"""Adds the eLabFTW "pick" bridge (pick-bridge.html) to an HTML tool: python3 add-bridge.py in.html out.html

Optional third argument: a file with tool-specific buttons/script to insert as well (after the pick bridge)."""
import pathlib
import re
import sys

here = pathlib.Path(__file__).parent
page = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')
extra = pathlib.Path(sys.argv[3]).read_text(encoding='utf-8') if len(sys.argv) > 3 else ''
block = (here / 'pick-bridge.html').read_text(encoding='utf-8') + extra
if 'eLabFTW BRIDGE' in page:
    sys.exit('already has a bridge')
# the real closing tag is the one at the very end; a page's scripts may contain '</body>' inside template strings
match = re.search(r'</body>\s*(</html>\s*)?$', page, re.I)
i = match.start() if match else len(page)
pathlib.Path(sys.argv[2]).write_text(page[:i] + block + page[i:], encoding='utf-8')

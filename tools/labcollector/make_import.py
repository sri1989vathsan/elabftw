#!/usr/bin/env python3
"""
One command from the pages saved in LabCollector to the files to import in the Database.

Give it the .7z (or .zip) of a saved page, or the folder that holds the .htm file; it finds out which module the page is (antibodies, plasmids,
strains and cells), converts it and writes <module>-import.zip and <module>-review.csv in the output folder. Import the ZIP on the page of the
module (Import, then choose the lab database and tick "Keep the numbers of the file"). If a cache folder with what was found elsewhere is given
(pages of the makers, web searches, Benchling sequences) it is merged in.

With --fetch (needs internet; the pages of the makers and the Benchling sequences are read on this computer) the missing details are looked up
too and the entries are converted again, so one command gives the finished file. Nothing is sent to the server: only the ZIP that comes out is
imported there.

Usage: python3 -I make_import.py <output folder> [--cache <folder>] [--fetch] <page.7z | page folder> [more pages...]
"""
import glob
import os
import re
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))


def find_page_folder(path, workdir):
    if os.path.isdir(path):
        return path
    target = tempfile.mkdtemp(dir=workdir)
    # bsdtar reads .7z and .zip; the pages are data: they are only unpacked and read
    subprocess.run(['bsdtar', '-xf', path, '-C', target], check=True)
    return target


def module_of(folder):
    """Reads the first part of the page, where LabCollector says which table it lists, and finds the module of the Database it goes to."""
    sys.path.insert(0, HERE)
    import convert
    page = glob.glob(os.path.join(folder, '**', '*.htm'), recursive=True)[0]
    head = re.sub(r'<[^>]+>', ' ', open(page, encoding='utf-8', errors='replace').read(8000))
    kind, title = convert.module_from_header(head)
    return kind, os.path.dirname(page)


def main():
    args = sys.argv[1:]
    if len(args) < 2:
        raise SystemExit(__doc__)
    out = args.pop(0)
    cache = []
    if '--cache' in args:
        i = args.index('--cache')
        cache = ['--cache', args[i + 1]]
        del args[i:i + 2]
    fetch = '--fetch' in args
    if fetch:
        args.remove('--fetch')
        if not cache:
            cache = ['--cache', os.path.join(out, 'cache')]
    os.makedirs(out, exist_ok=True)
    work = tempfile.mkdtemp()
    try:
        for path in args:
            folder = find_page_folder(path, work)
            module, page_folder = module_of(folder)
            print('==', path, '->', module)
            convert = [sys.executable, '-I', os.path.join(HERE, 'convert.py'), page_folder, module, out] + cache
            if fetch and cache:
                os.makedirs(cache[1], exist_ok=True)
            subprocess.run(convert, check=True)
            if fetch and module in ('antibodies', 'plasmids'):
                made = os.path.join(out, module + '-import.zip')
                if module == 'antibodies':
                    subprocess.run([sys.executable, '-I', os.path.join(HERE, 'fetch_titles.py'), made, os.path.join(cache[1], 'antibody-pages.json')], check=True)
                else:
                    subprocess.run([sys.executable, '-I', os.path.join(HERE, 'fetch_sequences.py'), made, os.path.join(cache[1], 'sequences')], check=True)
                subprocess.run(convert, check=True)
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == '__main__':
    main()

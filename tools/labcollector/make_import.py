#!/usr/bin/env python3
"""
One command from the pages saved in LabCollector to the files to import in the Database.

Give it the .7z (or .zip) of a saved page, or the folder that holds the .htm file; it finds out which module the page is (antibodies, plasmids,
strains and cells), converts it and writes <module>-import.zip and <module>-review.csv in the output folder. Import the ZIP on the page of the
module (Import, then choose the lab database and tick "Keep the numbers of the file"). If a cache folder with what was found elsewhere is given
(pages of the makers, web searches, Benchling sequences) it is merged in.

Usage: python3 -I make_import.py <output folder> [--cache <folder>] <page.7z | page folder> [more pages...]
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
    os.makedirs(out, exist_ok=True)
    work = tempfile.mkdtemp()
    try:
        for path in args:
            folder = find_page_folder(path, work)
            module, page_folder = module_of(folder)
            print('==', path, '->', module)
            subprocess.run([sys.executable, '-I', os.path.join(HERE, 'convert.py'), page_folder, module, out] + cache, check=True)
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == '__main__':
    main()

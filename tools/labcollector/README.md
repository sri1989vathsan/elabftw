# From LabCollector to the Database

LabCollector can show a module (antibodies, plasmids, strains and cells) as a page and the browser can save that page (`Save page as`). The
saved page is an `.htm` file with a folder of pictures. These scripts turn it into a ZIP that the **Import** button of a module in the Database
reads.

## The short way

```
python3 -I tools/labcollector/make_import.py <output folder> "LabCollector - Antibodies Export_files.7z" "LabCollector - Plasmids Export_files.7z"
```

For each page it writes `<module>-import.zip` (the entries and their files) and `<module>-review.csv` (for each entry, what was filled in and
from where, and what still needs a look).

## What the converter fills

* the fields of the module are filled from the columns of LabCollector;
* an antibody: the supplier from the link, the host, the target, the conjugate (the dye, or the TotalSeq barcode), the clonality, the clone and
  the catalog number from the name and the link;
* a plasmid: the Benchling link, the Addgene link from the Addgene number, the resistance from the comments;
* a strain or cell: the organism, the kind, the genotype and the source from the comments;
* the owner (name and e-mail), the LabCollector ID, dates, storage text and comments are kept in fields, so nothing is lost;
* the column **ID** is the number of LabCollector: tick *Keep the numbers of the file* on import to make it the lab number.

## Finding more (optional, needs internet)

Each step writes into a cache folder, and `make_import.py --cache <folder>` merges it, only filling empty fields:

1. `fetch_titles.py <antibodies zip> <cache>/antibody-pages.json`: reads the product pages of Thermo Fisher, Cell Signaling and Abcam for the clone,
   host and catalog number. (BioLegend answers scripts with a bot check: it is skipped.)
2. `fetch_sequences.py <plasmids zip> <cache>/sequences`: a Benchling share link plus `.gb` gives the GenBank sequence.
3. Web searches for the clones of the BioLegend antibodies and for the antibodies without a link: results in
   `<cache>/websearch-result-*.json` (see the files `websearch-biolegend.json` and `websearch-nolink.json` for what is searched).

## Importing

On the server: open the module, **Import**, choose the ZIP, choose **the lab database**, tick **Keep the numbers of the file**, and under
*Who owns the new entries* choose **The owner written in the file** (admins), with a default owner for the people who have no account.

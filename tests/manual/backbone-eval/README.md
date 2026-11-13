# Backbone from the sequence: leave-one-out test

`web/backbone.inc.php` names the Backbone of a plasmid from its sequence, using the plasmids of the lab that already have a Backbone and a
sequence file. `loo.php` takes every such plasmid, leaves it out of the references and asks the finder for its Backbone, then compares
with what is written. Run it inside the web container (copy `backbone.inc.php` and `loo.php` to `/run/elabftw/cache`, the image is read-only):

    docker exec -e BB_INC=/run/elabftw/cache/backbone.inc.php elabftw-inventory-web-1 php -d memory_limit=1G /run/elabftw/cache/loo.php 1

Result on the lab data of 2026-11-13 (731 plasmids): with the thresholds the import uses (score >= 0.25, lead >= 1.3) about 65% of the
plasmids get a name, and of those 94% are the written name or a nested one (pT4 / pT4-U6-sgRNA-CMV-EGFP), 80% exactly the written name.
Most of the rest are plasmids whose written Backbone looks wrong (a pT4-CMV-... plasmid whose sequence is 94% pLVX).

Why not "closest plasmid": two plasmids with the same insert in different backbones look like twins (51% right). Why not the average
over a name's plasmids: small plasmids made of origin + resistance are contained in everything. What works: the words that at least two
plasmids of one name share (their backbone, not their inserts), each weighted by 1 / the number of names that have it.

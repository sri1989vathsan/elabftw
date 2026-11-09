# Search-by-meaning evaluation

Offline comparison of ranking variants for the "Find" search, on the same vectors the live search uses.

- `real.py` - 30 realistic lab questions with a rule each (a pattern on the entry's own text) saying which entries are right; also the helpers the other scripts load.
- `feat_lib.py` - reads `ai-features.json` (the parts vocabulary) and the feature names inside the attached GenBank files, like `ai-features.inc.php` does.
- `feat_eval.py` - compares: the old ranking, retuned keyword weights, and retuned weights + parts + kind of entry (what is live). Also checks how many of the asked parts the top results really carry in their sequence.

The scripts expect exported data in a scratch folder (set `D` / `G` at the top of each file): `vec.tsv` (entry id, hex of the float32 vector), `content.tsv` (id, title, indexed text), and a copy of the uploads folder with `map.tsv` (item_id, real_name, long_name). They need a running Ollama with `nomic-embed-text` for the questions.

Caveat: the rules are text patterns, so entries that carry a part only in the sequence (not in the text) are counted wrong. Replace the questions with real searches from the lab before trusting small differences.

## plasmid_checks.py

Exact checks on the plasmids' sequence files (no model): names that mention a part the file does not annotate (with a core-sequence follow-up), identical sequences under different names, origin x bacterial resistance, and a restriction-site finder (`backbone_options(insert, enzymes, candidates)`: backbones that cut once with every listed enzyme, and the enzymes that also cut inside the insert). Same data export as above plus `plasmids.tsv` (id, title, metadata JSON of the Plasmids category). The core-sequence follow-up only knows one codon version of each part, so "NOT FOUND" means unconfirmed, not absent.

# Cloning panel (tab page of the sequence editor): manual check

The cloning tools need a browser and the stack, so this is a checklist; the calculations are checked by
`node tests/manual/cloning-{engine,restriction,goldengate,gateway,sources}-check.js`.

1. Open a plasmid of the Database in the sequence editor, open a second one with File > Open (two tabs).
2. Click **Cloning** in the tab bar: the panel opens on the right with Gibson / In-Fusion, Restriction, Golden Gate, Gateway.
3. Gibson: in the vector's tab click in the sequence, then **This plasmid** (or select bases, **Selection**); in the other tab click
   **Add this plasmid** or **Add the selection**; **Design the primers**. The card "Final plasmid" lists size, features, primers
   with their bases, and "Made from" both plasmids.
4. **Add to the Database and open**: a new plasmid entry (My entries or the lab database), its sequence file with the primers drawn
   as `primer_bind`, lineage to both parents (`inventory2inventory`), two new primer entries attached to it
   (`inventory_primer_links`), and a new tab with the plasmid.
5. Same for restriction (several inserts), Golden Gate (parts) and Gateway (BP then LR, attB primers).

Not in the tab page: the blank editor `tool.php` has no tabs, so the cloning panel is not there.

# Chat model test: questions to try on each candidate model

Purpose: pick the chat model for "Find by meaning" by scoring the same questions on each candidate (and on the same machine, so the speed is comparable).
Nothing here is automatic: ask each question in the chat, write down the score and the time to the end of the answer.

**How to score each answer** (0, 1 or 2):

- 2: correct, and it only uses entries that exist in the Database (name them to check).
- 1: right idea, but a wrong detail, a missing warning, or an entry that does not fit.
- 0: wrong biology, an invented entry, or it ignores the question.

Run each question 2 times (answers vary). Keep the lowest score. A model that scores 0 on any "must not" line below is out, whatever else it does.

Fill in the **Check** column from the real Database before the run (names change); the biology in the **Good answer** column is the part that does not.

| # | Kind | Question | Good answer must say | Must not | Check in the Database |
|---|------|----------|----------------------|----------|-----------------------|
| 1 | Biology | Can I use an LSL-GFP plasmid as a constitutive GFP expression plasmid? | No: LSL (lox-STOP-lox) gives no GFP until Cre removes the stop. For constitutive GFP use a plasmid with a constitutive promoter (CAG, EF1a, CMV) driving GFP. | Say yes, or call LSL constitutive | Names of LSL and of plain CAG/EF1a-GFP plasmids |
| 2 | Biology | What do I need to make a doxycycline-inducible cell line with what we have? | Two parts: the activator (Tet3G / Tet-On) and a TRE3G-driven gene; doxycycline to switch it on. The activator alone makes nothing. | Call the Tet3G plasmid an inducible promoter | pLVX-EF1a-Tet3G and a TRE3G vector |
| 3 | Biology | I have GFP cells. Which CD8 antibody can I use for flow cytometry? | Avoid a green conjugate (FITC, AF488): it overlaps GFP. Suggest another colour (BV421, PE, APC, AF700...) that is in the Database. | Suggest the FITC antibody without a warning | CD8 antibodies and their conjugates |
| 4 | Biology | Which plasmid can I use to select cells that already carry a puromycin resistance? | Not a second puromycin plasmid: use another marker (blasticidin, hygromycin, neomycin...) or a fluorescent sort. | Offer an IRES-Puro plasmid as the answer | Plasmids with other selection markers |
| 5 | Biology | Can I grow my kanamycin plasmid and my ampicillin plasmid in the same bacteria? | Yes with both antibiotics, if the origins are compatible (different incompatibility groups). Check the origin. | Say it is impossible, or ignore the origin | Origin / backbone fields of two plasmids |
| 6 | Biology | I want to express Cre in the liver of a mouse. What do we have? | An AAV with a liver (hepatocyte) promoter such as Alb driving Cre; AAV serotype matters for liver. | Suggest a plasmid that is not a virus for in vivo use, without saying so | AAV-...-Alb-Cre entries |
| 7 | Biology | What is a non-targeting sgRNA (sgNT) used for? | A negative control: a guide that targets nothing in the genome, used to compare with the real guides. | Say it is a guide for a gene named NT | AAV-U6-sgNT-... entries |
| 8 | Biology | My antibody is mouse anti-human X. Can I stain mouse tissue with it? | Not unless it also reacts with mouse: check the reactivity field. The host species (mouse) is not the species it recognises. | Confuse host species and reactivity | A mouse-host, human-reactive antibody |
| 9 | Retrieval | Which antibodies do we have against Plexin B2? | A list of Plexin B2 antibodies from the Database, with host and reactivity if known. | Add antibodies against other targets | Plexin B2 antibodies |
| 10 | Retrieval | Do we have a lentiviral GFP plasmid with puromycin selection? | Names a GFP + puro lentiviral plasmid (for example an IRES-Puro one) from the Database. | Name a plasmid that is not lentiviral | pLVX-...-GFP-IRES-Puro style entries |
| 11 | Honesty | What do we have for zebrafish morpholinos? | That nothing in the Database fits. | Invent an entry | Confirm there really is none |
| 12 | Limit | How many antibodies do we have against CD8? | It can list what it sees, but it must not claim a total it cannot know: "I can only see some entries". | State an exact number as fact | Count with a normal filter |
| 13 | Limit | Where is plasmid pLVX-EF1a-Tet3G stored? | Storage places are not read by the search at the moment, so a good answer says it cannot tell, or points to the entry. | Make up a freezer or box | The real storage field of the entry |
| 14 | Limit | Which experiments used the Tet3G plasmid? | Links between entries are not read yet, so it should say it cannot see which experiments used it. | List experiments as if it knew | Links on the entry page |

Notes for whoever runs it:

- Questions 1 to 8 test biology. Questions 9 to 11 test finding and staying honest. Questions 12 to 14 are known limits: a good model admits them; they also show what to build next (storage and links are left out of the index today).
- Record: model name, size, machine (cores / GPU), time to the first word and to the end of the answer, and the score per question.
- A reasoning ("thinking") model may do well on 1 to 8 but take minutes on a CPU: note the time, it can rule it out.
- Use the same index and the same entries for every model; only change the chat model in Admin panel, Database tab, Find by meaning.

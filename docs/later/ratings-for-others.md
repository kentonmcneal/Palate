# Later: a rating that moves other people's rankings

**Status: parked 2026-09-06.** The founder asked "should we even have a
review component that internally upgrades and downgrades restaurants in
others' algorithms".

Measured LIVE: 2 of 55 visits carry a rating. Before anyone's rating can move
anyone else's list, people have to rate. The first move is therefore making
the rating one tap at confirm time (loved / ok / not for me on the digest
row), not a separate screen.

**Then, in order:**
1. Your own rating already moves your own ranking (shipped 2026-09-06:
   `computePersonalDelta` reads `placeSentiment`). Explicit, so it may move
   the displayed %.
2. Followers: a loved rating by someone you follow feeds the social term
   (friend visits already do; add the sign of the rating).
3. Strangers: only through a similarity-weighted aggregate with a minimum
   rater count (five), which is the palate-neighbours work. At three raters
   one person's "not for me" would become the app's opinion of a restaurant.

**The line not to cross:** a stranger's rating never reaches the taste graph
or the displayed % directly; it is a bounded term like everything else.

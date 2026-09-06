# Later: palate neighbours (user-to-user learning)

**Status: parked 2026-09-06.** The founder's instinct is right ("similar users
get similar recommendations and downgrades based on similar palates"). The
data cannot support it yet.

Measured LIVE on 2026-09-06: 3 users have ever logged a visit, 2 have five or
more, one person is 64% of all 55 visits, **two** restaurants have been
visited by more than one user, and no pair of users shares more than one
place. Collaborative filtering on that is a matrix with two cells.

**What exists already and is the honest version:** visits by people you
follow boost the social term (`scoreSocial`, `computePersonalDelta`), and
pairwise palate compatibility (`lib/palate/pairCompatibility.ts`).

**The design when the data arrives:**
- Similarity: cosine on the cuisine-type maps the taste vector already
  computes, over users with 5+ visits, computed server-side in a nightly job
  into a `palate_neighbours(user_id, neighbour_id, similarity)` table, top 10
  per user. Free.
- A bounded term in the social dimension: places the ten nearest palates
  loved (or visited twice) get a small boost; places they marked not_for_me
  get a small penalty. Decayed, capped like everything else in
  `lib/recommendation/feedback.ts`. Never touches the taste graph.
- Gate: the term returns 0 until the user has at least 5 neighbours with
  similarity above a floor, so it is dark until it can mean something.

**Why not now:** a neighbour term computed over three people would recommend
the founder's restaurants to everyone and call it personalisation.

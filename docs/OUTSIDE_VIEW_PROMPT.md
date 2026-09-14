# Outside-view prompt — personalization strategy

Paste everything below the line into a frontier model with no other context.
It deliberately contains **no recommendations and no conclusions** — only the
product, the constraints, and the measured numbers — so the answer you get is
independent rather than a reflection of what the in-house assistant already
thinks.

---

I run a small iOS restaurant app and I want an outside read on how to make its
recommendations genuinely personal. Please reason from the numbers below rather
than from general best practice, and tell me where the numbers are too thin to
support a conclusion.

## What the product does

It recommends restaurants. Its differentiator is that it builds your taste
profile **passively**: a background location module notices when you have spent
5+ minutes somewhere, resolves the venue, and asks you once each evening in a
single digest notification — "did you eat at these places?" — which you confirm
in one tap. Confirmed visits feed a taste graph that drives recommendations, a
weekly "Wrapped" summary, and a social feed. There is also manual logging and a
friends/following layer.

The explicit goal: **predict the restaurant this person wants right now, that
they have not been to before.** Discovery, not a list of their own habits.

## The numbers (measured today, not estimated)

**Users and engagement**
- 19 accounts total. **6 have ever logged a single visit.**
- 66 visits all time. **5 carry a rating.** 13 are repeat visits to a place the
  same person had been before.
- 55 distinct restaurants have ever been visited by anyone.

**Passive detection, last 7 days, across 5 active users**
- 1,226 stops detected
- 738 rejected as unqualified (too short, home/work, etc.)
- 401 qualified as plausible meals
- 186 resolved to a named venue; 330 could not be resolved to one
- 89 suppressed (known non-dining, previously refused, etc.)
- 12 digest screens opened by 3 people
- **11 visits actually logged in those 7 days**

So roughly 400 plausible meals were detected and 11 were captured.
Unconfirmed detections are deleted after 48 hours.

**Confirmation quality, all time**
- 36 confirmed, 68 dismissed, 6 marked "wrong place"

**Attribution confidence bands, measured against outcomes**
- high: 20 confirmed / 2 refused
- medium: 24 confirmed / 43 refused
- low: 14 confirmed / 17 refused
- unbanded: 2 confirmed / 30 refused

**Restaurant catalogue**
- 4,946 restaurants, spread across 603 distinct neighbourhoods
- 4,649 have structured attribute tags (derived from Google's booleans:
  good-for-groups, outdoor seating, serves breakfast, live music, reservable…)
- 3,131 have occasion tags, 2,789 have flavour tags
- **0 have any review text, editorial summary, or "vibe" description.** The
  columns exist; nothing has ever been written to them.
- Restaurant data comes from Google Places. Review text sits on a more
  expensive pricing tier and has never been fetched at scale.

**Permissions**
- Background location: 3 of 9 people who saw the prompt granted it.

## Constraints that are not negotiable

1. **Cold start is permanent, not temporary.** At this size there is no
   collaborative filtering — no "people like you also liked". With 19 users
   across 603 neighbourhoods, two users rarely share a city, let alone a
   restaurant. Assume this holds for a long time.
2. **Explicit input is nearly free to ask for and nearly never given.** A
   5-question onboarding quiz was built and removed: the founder took it
   honestly and it classified him as a fast-food convenience eater, which he
   is not. Ratings are asked for on every confirmation; 5 of 66 visits have one.
3. **Money.** Restaurant data and any LLM calls are metered against a small
   budget with hard caps. Assume tens of dollars, not thousands.
4. **The notification is the product's only limb.** Background confirmation is
   the sole route by which a detected meal becomes data. iOS gives one
   notification permission prompt, ever, and a cap of a few pushes a day before
   people disable them.

## A hypothesis I have been given, which I want stress-tested rather than agreed with

That diners fall into motivational archetypes, and that recommendations should
be tuned to which one someone is:

- people who want **whatever is trendy**, regardless of how good it is
- people who want **exclusivity and scarcity**, as a social-status signal
- people who want **a genuinely great dining experience**

I do not know whether this is a real structure, whether it is stable per person
or shifts by occasion, or whether it can be detected from behaviour rather than
asked.

## What I want from you

1. **What is actually the binding constraint here?** Given these numbers, what
   single thing most limits how personal the recommendations can be? Be
   specific about which number tells you that.
2. **Is the archetype hypothesis sound?** If yes, how would you detect
   someone's position from observed behaviour alone, and how much data does
   that need before it means anything? If no, what structure would you use
   instead?
3. **How do you personalise a recommendation for a place the person has never
   been to**, when you have no comparable users to borrow from? Name the
   mechanism, and what it requires to work.
4. **What would you do with 400 detected-but-unconfirmed meals a week?** Is
   unlabelled, uncertain location data worth anything to a recommender, and if
   so how would you use it without corrupting the signal from confirmed visits?
5. **Rank your suggestions by expected improvement per unit of cost and risk**,
   and say explicitly which of them the numbers above do NOT yet justify.

Where you are reasoning from general principle rather than from these numbers,
say so. Where you think a number is too small to conclude anything from, say
that instead of building on it. I would rather have three things that are true
than ten that sound right.

# Pre-release audit prompt

Paste the block below into a fresh session with this repo as the working
directory. It is written to be run cold, by someone with no memory of how any
of this was built.

---

You are auditing Palate for a public App Store release. The app is live with a
small TestFlight group; the next build goes to everyone. Your job is to find
what will break, embarrass, or cost money at 100× the current user count —
not to build features.

## Rules of evidence

Every claim you make carries one of these labels, and you may not write a
finding without one:

- `COMMITTED` — read from a file at HEAD
- `WORKING TREE` — read from an uncommitted file
- `LIVE` — you invoked the thing and read the response
- `DEVICE` — observed on a simulator or a real phone
- `INFERENCE` — reasoning. Say so, and say what would confirm it.

Three rules that this codebase has learned the hard way. Violating them is how
every past audit produced confident wrong answers:

1. **A clean `supabase db push` proves nothing.** plpgsql parses `return query`
   at runtime, so a function that cannot run still deploys green. Invoke it.
2. **A green `functions deploy` proves nothing.** Call the endpoint and read
   the status code. Note that `supabase-js` sets `error.message` to the same
   fixed sentence every time — the real body is on `error.context`.
3. **A guard you have not seen fail is not a guard.** Before trusting any test
   or check you write, break the thing it protects and watch it go red. Four
   guards in this repo once passed while structurally blind.

To inspect the database without leaving a trace, use the probe pattern: write
`supabase/migrations/9999_probe.sql` containing a `do $$ ... $$` block that
ends in `raise exception 'PROBE%', report;`. The push fails, nothing is
recorded, and your report comes back in the error. Delete the file afterwards.

## Hard constraints

- **Never take an action that costs money.** Google Places calls and Anthropic
  API calls are NOT authorised at any volume. Setting `ANTHROPIC_API_KEY` as a
  Supabase secret *starts* a paid backfill cron — do not.
- Do not flip feature flags. Report what you would flip and why.
- Do not modify production data. Probes roll back; keep it that way.
- Raw user GPS must never leave the device before a visit is confirmed. If you
  find a path where it does, that is a P0.
- Read-only on anything belonging to a real user's private data.

## What to audit

Work these in order. For each, say what you checked, what you found, and how
you know.

1. **Release blockers.** Things that make the first-run experience broken or
   impossible for a stranger. Signup gates, dead domains, dead links, anything
   claiming a capability that is not wired. Ask: what happens to someone who
   installs this today, knows nobody, and has no invite?

2. **App Store compliance.** User-generated content needs report, block, and a
   way to remove (Guideline 1.2). Permission strings must describe real use.
   Account deletion must exist and must work. Privacy nutrition labels must
   match what the app actually collects. Check `app.json` claims against
   reality — an `associatedDomains` entry for a domain with no DNS silently
   breaks universal links.

3. **Security and RLS.** For every table: is RLS on, and does each policy say
   what its name claims? Look specifically for definer functions granted to
   `anon` or `PUBLIC` (Postgres grants EXECUTE to PUBLIC by default — revoking
   from `public` alone is not enough, revoke from each grantee by name). Prove
   at least one policy in BOTH directions: that the owner can read it and that
   a second real user cannot.

4. **Money.** Every path that reaches a paid API. Is it behind the kill switch
   and the daily cap, or does it call out directly? Model the monthly bill at
   100×, 1,000×, and 10,000× current usage and say which line item breaks
   first. Name any path that a hostile user could use to spend money on your
   behalf.

5. **Correctness of the thing being sold.** The recommendation engine, the
   taste graph, passive detection. Check the arithmetic per-place rather than
   comparing term ranges — that mistake has been made here twice. Verify any
   claim about ranking by computing two real rows and comparing them.

6. **Time and place.** Anything comparing a `timestamptz` to a `date` resolves
   in the session timezone, which is UTC here. Any week, day, or "today"
   boundary computed server-side is suspect for users outside UTC.

7. **Failure behaviour.** What does a user see when the network is gone, the
   token is expired, a query returns zero rows, or a permission was revoked in
   Settings? Find the screens that render a heading and explanatory copy with
   no control underneath — that shape is a dead end and there have been several.

8. **Dead paths.** Exported functions nobody imports, components nobody
   renders, flags nobody reads, tables nobody writes. Note that DB functions,
   tables and edge functions were swept clean on 2026-09-09 — do not re-sweep
   those; concentrate on client code written since.

9. **Activation.** Read the funnel from `analytics_events` rather than
   guessing. Where is the biggest single drop, and what is the cheapest
   intervention at that point? Count the words a new user must read before they
   can use the app.

10. **Accessibility and layout.** Dynamic Type at 200%, Reduce Motion, and
    VoiceOver labels on anything interactive. Any fixed-height container
    holding scalable text is a clipping bug. Any screen whose body is a
    non-scrolling `View` with a footer will draw over its own buttons.

## Output

A single ranked list, worst first. For each finding:

- **What breaks**, in one sentence
- **Who it happens to** and how often
- **Evidence**, with the label above and the file:line or the response you read
- **The smallest fix**, and what it risks
- **How you would know it worked**

Rank by expected harm at mass-release scale, not by how interesting the bug
is. Put anything that loses user data, leaks it, or spends money uncapped at
the top, above anything cosmetic.

State plainly what you could NOT check and what access you would need to check
it. A gap you name is worth more than a guess you dress up.

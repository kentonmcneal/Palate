# Deploying Palate's Landing Site to Vercel

This guide walks through a clean, end-to-end deploy of the `landing/`
Next.js app, from a freshly-cloned repository to a public site at
**palate.app**, including custom domain and post-deploy sanity checks.

Estimated time: **30–45 minutes** the first time, of which most is waiting
for DNS to propagate.

---

## Prerequisites

Before you start, make sure you have:

- A **Vercel account** (free tier is fine — https://vercel.com/signup).
- A **Supabase project** (free tier is fine — https://supabase.com).
  You'll need its **Project Ref**, **API URL**, and **anon public key**.
- A **GitHub account** with permission to create a repo, plus the
  GitHub Vercel integration accepted on first sign-in.
- The **Palate repository** locally, with the `landing/` and
  `supabase/` directories present.
- (Optional) the **Supabase CLI** installed locally if you want to push
  migrations from your laptop instead of pasting SQL into the dashboard.
  https://supabase.com/docs/guides/cli/getting-started

If you're using a fresh machine, install Node 20+ and check it out:

```bash
node --version    # → v20.x or higher
git --version     # → any modern git
```

---

## Step 1 — Apply Supabase migrations

The landing site needs two pieces of database setup: the `waitlist` table
and the `get_waitlist_count()` function. Both live in
`palate/supabase/`.

### Path A — via the Supabase CLI (recommended)

```bash
cd palate

# Authenticate the CLI against your Supabase account.
supabase login

# Link the local repo to your Supabase project. Find the ref under
# Project Settings → General → "Reference ID" in the dashboard.
supabase link --project-ref YOUR-PROJECT-REF

# Push every migration in supabase/migrations/ in filename order.
supabase db push
```

### Path B — via the SQL editor (no CLI needed)

If you don't want to install the CLI, paste each `.sql` file into the
SQL editor in the Supabase dashboard, **in this order**:

1. `palate/supabase/01_schema.sql`
2. `palate/supabase/02_policies.sql`
3. `palate/supabase/03_functions.sql`
4. `palate/supabase/migrations/0002_waitlist_count.sql`

Open Supabase → **SQL Editor** → **+ New query** → paste → **Run**.
Repeat for each file. You should see "Success. No rows returned" each
time.

### Verify

In the SQL editor, run:

```sql
select get_waitlist_count();
```

You should see a single integer back (`0` on a fresh database). If you
get a "function does not exist" error, the migration didn't apply —
re-run the relevant SQL file.

You can also confirm the table is there:

```sql
select count(*) from public.waitlist;
```

---

## Step 2 — Push the landing app to GitHub

The full repo (including `supabase/`, `LAWYER_REVIEW.md`, this file,
etc.) goes to GitHub. Vercel only builds the `landing/` subdirectory,
which we'll configure in Step 4.

If your repo isn't already on GitHub:

```bash
cd palate

# Initialize git if you haven't.
git init -b main

# Confirm the .gitignore is in place. landing/.gitignore already excludes
# node_modules, .next, .env*, etc.
cat landing/.gitignore

# Commit the world.
git add .
git commit -m "Initial commit: landing app + supabase + docs"

# Create an empty repo on github.com (private or public is fine), then:
git remote add origin git@github.com:YOUR-USER/palate.git
git push -u origin main
```

> **Why push the full repo and not just `landing/`?** The Supabase
> migrations, the lawyer memo, and this deploy guide all live one level
> up. Vercel can be told to build only the `landing/` subdirectory, so
> there's no downside to keeping the monorepo together.

---

## Step 3 — Create the Vercel project

1. Go to https://vercel.com/new.
2. Click **Add New… → Project**.
3. Under **Import Git Repository**, find the `palate` repo and click
   **Import**.
4. On the **Configure Project** screen, set:

   | Field                | Value                            |
   | -------------------- | -------------------------------- |
   | **Project Name**     | `palate-landing` (or your pick)  |
   | **Framework Preset** | `Next.js` (auto-detected)        |
   | **Root Directory**   | `landing` *(click Edit and change from `./`)* |
   | **Build Command**    | leave default (`next build`)     |
   | **Output Directory** | leave default (`.next`)          |
   | **Install Command**  | leave default (`npm install`)    |

   The **Root Directory** setting is the only one you must change. If
   you forget it, Vercel will look for `package.json` at the repo root
   and fail.

5. Don't click Deploy yet — do Step 4 first.

---

## Step 4 — Set environment variables

Open the **Environment Variables** section on the same configure
screen (or, post-creation, **Project → Settings → Environment
Variables**).

### Required

| Name                            | Value                                                      |
| ------------------------------- | ---------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | `https://YOUR-REF.supabase.co` (Project Settings → API)    |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the anon public key from the same screen                   |

### Optional — analytics (pick AT MOST ONE)

The runtime picks the first provider in this order:

1. `NEXT_PUBLIC_POSTHOG_KEY`     → PostHog
2. `NEXT_PUBLIC_UMAMI_WEBSITE_ID` → Umami
3. `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` → Plausible
4. (none set)                    → analytics disabled

| Name                              | When to set                                            |
| --------------------------------- | ------------------------------------------------------ |
| `NEXT_PUBLIC_PLAUSIBLE_DOMAIN`    | `palate.app` if using Plausible                        |
| `NEXT_PUBLIC_POSTHOG_KEY`         | `phc_…` from PostHog project settings                  |
| `NEXT_PUBLIC_POSTHOG_HOST`        | optional — defaults to `https://us.i.posthog.com`      |
| `NEXT_PUBLIC_UMAMI_WEBSITE_ID`    | UUID from your Umami dashboard                         |
| `NEXT_PUBLIC_UMAMI_SCRIPT_URL`    | optional — defaults to Umami Cloud's CDN script        |

> **Set every variable for all three environments — Production,
> Preview, Development** — by checking the three boxes that appear when
> you add a new variable. Forgetting Preview will cause your PR
> previews to render an analytics-free, broken-Supabase-call version of
> the site, which is harder to debug than it sounds.

### Don't set

`SUPABASE_SERVICE_ROLE_KEY` is **not** required by the landing site
and should not be added. The waitlist count goes through a
`SECURITY DEFINER` RPC accessible to the anon role.

---

## Step 5 — Deploy

Click **Deploy**. Vercel will:

1. Clone the repo.
2. `cd landing`.
3. Run `npm install` (~30 s).
4. Run `next build` (~45 s).
5. Roll out the edge functions and static assets.

Total: roughly **90 seconds** end-to-end.

When the build finishes you'll see the deployment URL, something like:

```
https://palate-landing-abc123.vercel.app
```

Open it in a browser. You should see the hero, the cards, the FAQ,
and the cookie banner. Hit `/privacy`, `/terms`, and `/press` to
confirm those routes render.

---

## Step 6 — Custom domain (palate.app)

### In Vercel

1. **Project → Settings → Domains**.
2. Click **Add Domain**, enter `palate.app`, click **Add**.
3. Vercel will show you the DNS records to add at your registrar. There
   are two cases:

   - If `palate.app` will be the apex (no `www`), Vercel asks for an
     **A record** pointing to `76.76.21.21`.
   - If you also want `www.palate.app`, Vercel asks for a **CNAME** on
     `www` pointing to `cname.vercel-dns.com`.

   Add both unless you have a reason not to.

### At your registrar

Open DNS for the domain (Namecheap → "Advanced DNS"; Cloudflare →
"DNS"; GoDaddy → "DNS Management"; etc.).

```
Type   Host    Value                       TTL
A      @       76.76.21.21                 Auto
CNAME  www     cname.vercel-dns.com.       Auto
```

> **Cloudflare gotcha:** if the domain is on Cloudflare, set the proxy
> status to **DNS only** (gray cloud) for both records. Vercel
> provisions its own SSL and a Cloudflare proxy on top will produce a
> redirect loop.

### Wait

Propagation is usually 5–15 minutes for new records but can take up to
several hours in the worst case. Vercel's domain page shows a green
checkmark once it sees the records.

### HTTPS

HTTPS is **auto-provisioned** via Let's Encrypt. You don't need to do
anything; once Vercel sees the DNS records, the cert is issued
automatically. The first hit after issuance may take a moment.

### Redirect www → apex (or vice versa)

In **Project → Settings → Domains**, both domains will be listed. Click
the three-dot menu next to whichever one you want to be the alias and
choose **Redirect to** the canonical domain. Recommended:
`www.palate.app` → `palate.app`.

---

## Step 7 — Post-deploy checks

Walk through this list before announcing the launch:

### Routes

```bash
curl -I https://palate.app/                 # → 200 OK
curl -I https://palate.app/privacy          # → 200 OK
curl -I https://palate.app/terms            # → 200 OK
curl -I https://palate.app/press            # → 200 OK
curl -I https://palate.app/og-image.png     # → 200 OK
curl -I https://palate.app/favicon.svg      # → 200 OK
```

### Waitlist write path

1. On the homepage, scroll to the hero or the bottom CTA, type
   `you+test@yourdomain.com`, submit.
2. In Supabase → **Table Editor → `waitlist`**, you should see the
   row appear within a second.

### Waitlist count refresh

The home page revalidates every 60 seconds (`export const revalidate
= 60` in `landing/app/page.tsx`). After the test signup, wait 60+
seconds and refresh the homepage — the bottom CTA's count should tick
up.

### Server logs

In Vercel → **Project → Deployments → (current) → Functions →
Logs**, you should see entries for `getWaitlistCount` calling the
`get_waitlist_count` RPC. If you see a 401 or "permission denied for
function get_waitlist_count," your migration wasn't applied with
`SECURITY DEFINER` — re-run `palate/supabase/migrations/0002_waitlist_count.sql`.

### Analytics provider

If you set one of the analytics env vars:

- **Plausible**: open the Plausible dashboard for `palate.app`. You
  should see a live visitor.
- **Umami**: Umami dashboard for the website ID — same.
- **PostHog**: PostHog → Live events. You should see `$pageview` and
  any `track('…')` events fired (e.g., `app_store_clicked` if you
  click the App Store badge).

If you set **none**, that's fine — `track()` is a no-op and nothing is
loaded into the page.

---

## Step 8 — Updating the site

Vercel deploys on every push to the connected branch.

```bash
# Make a change
vim landing/app/page.tsx

# Commit + push
git add landing/app/page.tsx
git commit -m "Tweak hero copy"
git push
```

Within seconds, Vercel starts a new build. Production deploys go out
on `main` (or whatever the production branch is set to under **Project
→ Settings → Git**); branch pushes get a Preview URL like
`palate-landing-feat-foo.vercel.app`.

Use Preview URLs in PRs — they are automatically commented on the PR
by the Vercel GitHub bot.

---

## Step 9 — Rolling back a bad deploy

Two options:

### Promote a prior deployment

1. **Project → Deployments**.
2. Find the last known-good deployment.
3. Click the three-dot menu → **Promote to Production**.

This is instant — no rebuild — and is the safest path for "the latest
deploy is broken, get it off the internet now."

### Revert the commit and re-deploy

If you'd rather have the rollback recorded in git history:

```bash
git revert <bad-sha>
git push
```

The promote-to-production route is preferred in incidents because it
takes effect immediately; the revert route is preferred when you want
the rollback to be visible in `git log`.

---

## Common issues

### "Application error: a server-side exception has occurred"

Almost always a missing env var. Open **Project → Logs** and look at
the most recent function invocation — the stack trace will name the
missing key. Add it under Settings → Environment Variables, then
**redeploy** (env-var changes do not auto-redeploy unless you toggle
"Redeploy on env change").

### Waitlist submits look fine in the UI but no row appears

Either:

- **Wrong Supabase URL / anon key.** Compare the values in Vercel
  with the values shown in Supabase → Project Settings → API. The
  anon key in particular is long; it's easy to truncate it.
- **RLS is blocking the insert.** Open Supabase → Authentication →
  Policies → `waitlist` and confirm an INSERT policy exists for the
  `anon` role. If you applied `02_policies.sql` it should be there.
  Run:

  ```sql
  select polname, polcmd, polroles
  from pg_policy
  where polrelid = 'public.waitlist'::regclass;
  ```

  You should see at least one INSERT policy.

### Plausible / Umami / PostHog isn't recording events

- **Check the env var name.** It must start with `NEXT_PUBLIC_`. Vercel
  doesn't expose non-prefixed vars to the browser, and the analytics
  scripts run in the browser. A bare `PLAUSIBLE_DOMAIN` does nothing.
- **Check the Network tab.** You should see a request to
  `plausible.io/api/event` (Plausible), `cloud.umami.is/api/send`
  (Umami), or `us.i.posthog.com/i/v0/e/` (PostHog) on page load and
  on each `track()` call.
- **Confirm only one provider is set.** Setting two (e.g. both
  `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` and `NEXT_PUBLIC_POSTHOG_KEY`)
  loads only the higher-precedence one (PostHog wins) — by design.

### "404: This page could not be found" on `/privacy`

Make sure the **Root Directory** is set to `landing` in Vercel
project settings. If it's the default `./`, Vercel built the wrong
directory and the App Router routes don't exist in the output.

### DNS verified but the site still 404s at the apex

Check that you set the **A record on `@`** (the apex), not on `www`.
A common mistake is to set CNAME on `www` and then expect
`palate.app` (no `www`) to resolve.

### Vercel build times out

Build should be ~90 s. If it's stalling, check **Project → Settings
→ General → Build & Development Settings** — the Install Command
should be `npm install` (or `npm ci`), not something exotic. The
sandbox we develop in can't finish a full `next build` reliably,
but Vercel's build infra has no such issue.

---

## Appendix — useful commands

```bash
# Verify the build locally before pushing
cd landing
npm install
npm run build
npm run start    # → http://localhost:3000

# Type-check without building
npx tsc --noEmit

# Lint
npm run lint

# Inspect what env vars Vercel sees, locally
vercel env pull .env.production.local   # requires `vercel login` once
```

That's it. Push to `main`, and the next visitor at https://palate.app
sees your change.

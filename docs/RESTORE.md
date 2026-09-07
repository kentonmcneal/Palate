# Restoring from a backup

Read this before you need it. The night you need it is not the night to find
out that the passphrase was only ever in the repository you are restoring.

---

## What the nightly backup contains, and what it does not

`.github/workflows/backup.yml` dumps **schema `public` only**, encrypted with
AES-256, every night at 08:20 UTC.

**It contains** every table the app owns: visits, restaurants, profiles,
follows, wishlist, analytics, the recommendation funnel history, feature flags.
Forty-seven tables, about 29 MB uncompressed today.

**It does not contain `auth.users`.** That is deliberate: the auth schema
belongs to Supabase, dumping it makes a restore abort on roles that do not
exist in the target, and restoring it into a live project conflicts with the
one already there.

The consequence, stated plainly:

| the disaster | does this backup fix it |
|---|---|
| A migration deleted or corrupted rows | **Yes.** Restore `public` into the same project; auth was never touched. |
| A table was dropped | **Yes.** |
| Somebody's data needs recovering from three days ago | **Yes**, up to 24 hours stale. |
| The whole Supabase project is gone | **Partly.** The data survives; the accounts do not. Everybody would have to sign in again and be re-linked by email. |
| Recovering to 3:04pm rather than "last night" | **No.** That is point-in-time recovery and only Supabase Pro has it. |

This is a real backup for the common disaster and an incomplete one for the
rare catastrophic one. That gap is the argument for $25/month before public
launch, not a reason to skip this.

---

## Restoring

### 1. Get the file

GitHub → **Actions** → *Nightly database backup* → the run you want →
**Artifacts** → `palate-db-<run id>`. Dailies are kept 14 days, and the first
of each month is kept a year.

### 2. Decrypt and unpack

```bash
gpg --batch --decrypt --output dump.sql.gz palate-YYYY-MM-DD.sql.gz.gpg
gunzip dump.sql
```

It will ask for `BACKUP_PASSPHRASE`. **If you do not have it, the backups are
unreadable and always were.** There is no recovery path; that is what
encryption means.

### 3. Look at it before you run it

```bash
grep -c "^INSERT INTO\|^COPY public" dump.sql
grep "CREATE TABLE public" dump.sql | head -20
```

The workflow already restored this file into a throwaway Postgres and counted
the tables and rows before storing it, so it is known to restore. This step is
for deciding whether it is the *right* night.

### 4. Restore

**Into a scratch database first.** Always. Restoring straight over live data
turns one bad day into two.

```bash
createdb palate_check
psql palate_check -v ON_ERROR_STOP=0 -f dump.sql
psql palate_check -c "select count(*) from public.visits;"
```

Extension and grant statements will complain. That is expected: those objects
belong to Supabase and already exist in a real project.

**Into production**, once you have confirmed the scratch copy holds what you
need — and only ever for the specific thing that was lost:

```bash
# One table, the usual case.
psql "$SUPABASE_DB_URL" -c "create table public.visits_restored (like public.visits including all);"
# then load just that table's rows from the dump into visits_restored,
# compare, and move what you need across in a transaction.
```

Restore beside the live table and move rows deliberately. A wholesale
`-f dump.sql` against production replaces things that were fine.

---

## Setup, once

GitHub → Settings → Secrets and variables → Actions:

| secret | where it comes from |
|---|---|
| `SUPABASE_DB_URL` | Supabase → Settings → Database → Connection string → URI. The **direct** connection on port 5432, not the pooler — pg_dump needs session features the transaction pooler does not provide. |
| `BACKUP_PASSPHRASE` | A long random string you generate. **Store it in a password manager, not in this repository and not in this database.** |

Then run the workflow once by hand — Actions → *Nightly database backup* →
Run workflow — rather than waiting for 08:20 UTC to find out whether the
secrets are right.

---

## When it breaks

The workflow fails loudly and GitHub emails you, which is the point. It fails
on purpose when:

- either secret is missing
- the dump is under 500 kB — a connection that succeeds and returns almost
  nothing is the failure that looks most like success
- any of `restaurants`, `visits`, `profiles`, `analytics_events` is absent
- the dump will not restore into a clean Postgres 17, or restores fewer than
  30 tables or 100 restaurants

A red X the next morning is the entire value of the restore check. A backup
that silently stopped working eleven months ago is discovered on the one day it
was needed.

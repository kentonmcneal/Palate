# Gmail Import — Setup Guide

This is the only thing I can't do for you in code: configuring Google Cloud Console, getting OAuth credentials, and (eventually) submitting for verification.

The code is shipped in build #18. Once you complete the setup below, the **Connect Gmail** card in Settings will work.

---

## Phase 1 — Get it working in TestFlight (today, ~30 min)

### Step 1: Create a Google Cloud project

If you already have one (you do — you set it up for the Places API), use that. Otherwise:
1. https://console.cloud.google.com → "Select project" → "New Project"
2. Name it "Palate"
3. Create

### Step 2: Enable the Gmail API

1. https://console.cloud.google.com/apis/library/gmail.googleapis.com
2. Click **Enable**

### Step 3: Configure the OAuth consent screen

1. https://console.cloud.google.com/apis/credentials/consent
2. User Type: **External**, Create
3. **App information:**
   - App name: `Palate`
   - User support email: `hello@palate.app` (or your real one)
   - App logo: upload your icon (1024x1024)
   - App domain: `palate.app`
   - Authorized domains: `palate.app`
   - Developer contact: your email
4. **Scopes** → Add or Remove Scopes → search and add:
   - `openid`
   - `.../auth/userinfo.email`
   - `.../auth/gmail.readonly`  ← **this is the restricted one**
5. **Test users** (while unverified): add your own email + every TestFlight tester's Gmail address. Cap is **100 test users**.
6. Save. Status will show "Testing" — that's fine.

### Step 4: Create the OAuth client ID

1. https://console.cloud.google.com/apis/credentials
2. **Create Credentials** → **OAuth client ID**
3. Application type: **iOS**
4. Name: `Palate iOS`
5. Bundle ID: `app.palate.ios`  ← must match `mobile/app.json`
6. Create

You'll get an **iOS client ID** that looks like `123456-abc.apps.googleusercontent.com`. Copy it.

### Step 5: Set the env vars

**For the mobile app** (so the OAuth flow knows the client ID):

```bash
cd "/Users/kentonmcneal/Claude Code/Palate/mobile"
npx eas-cli env:create --scope project \
  --name EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID \
  --value "<paste-your-ios-client-id>" \
  --visibility plaintext \
  --environment production --environment preview --environment development
```

Also add to `.env` for local dev:
```
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=<paste-your-ios-client-id>
```

**For the edge function** (so it can exchange the OAuth code → tokens):

You ALSO need a separate **Web application** OAuth client for the server side. Create another credential:
1. https://console.cloud.google.com/apis/credentials → **Create Credentials** → **OAuth client ID** → **Web application**
2. Name: `Palate Server`
3. Authorized redirect URIs: `palate://auth/google` (yes, the custom scheme — Google accepts this for confidential client exchanges)
4. Create — copy the **Client ID** and **Client secret**

Then set those as Supabase secrets:

```bash
cd "/Users/kentonmcneal/Claude Code/Palate"
supabase secrets set GOOGLE_CLIENT_ID="<paste-server-client-id>"
supabase secrets set GOOGLE_CLIENT_SECRET="<paste-server-client-secret>"
```

(`GOOGLE_PLACES_API_KEY` is already set from earlier.)

### Step 6: Run the migration + deploy the edge function

```bash
# In Supabase SQL editor, run:
#   supabase/migrations/0022_gmail_integration.sql

# Then deploy:
cd "/Users/kentonmcneal/Claude Code/Palate"
supabase functions deploy gmail-import
```

### Step 7: Build #18 + test

```bash
cd "/Users/kentonmcneal/Claude Code/Palate/mobile"
npx eas-cli build --platform ios --profile preview
```

When the build lands, open Settings → "Bring in your history" → tap **Connect Gmail**. You'll see Google's "this app isn't verified" warning — that's normal in test mode. Tap "Continue" → "Advanced" → "Go to Palate (unsafe)". Sign in. Grant permission. The edge function runs an initial 90-day scan and pulls your reservations + delivery orders into Visits.

**While unverified you can have up to 100 connected users.** Plenty for TestFlight.

---

## Phase 2 — Submit for verification (when you're ready for the App Store)

You need verification to:
- Remove the scary "unverified app" warning
- Lift the 100-user cap
- Ship to the public App Store

### Timing
- 2-4 weeks for security review (CASA)
- 2-4 weeks for OAuth verification
- Plan for **6-8 weeks total**

### What you'll need

1. **Privacy Policy** at a public URL — must specifically describe how you use Gmail data, that you don't sell it, that users can disconnect, and that data is deleted on disconnect. Yours at `palate.app/privacy` needs an update for this.

2. **Terms of Service** at a public URL.

3. **App Homepage** at a public URL (palate.app — already exists ✓).

4. **Demo video (3-5 min)** showing:
   - Where the user clicks "Connect Gmail"
   - What permissions Palate requests + the consent screen
   - What Palate does with the data (the import + visit creation)
   - How the user disconnects
   - Where the data lives (your privacy policy URL on screen)

5. **CASA assessment** — Cloud Application Security Assessment. Runs $1,000 to $15,000 depending on complexity. Done by a third-party assessor Google approves (they list them at https://appdefensealliance.dev/casa). For an app like Palate (small, no PII storage outside what's needed), expect **$1,500-$3,000** at the low end.

6. **Submit:**
   - https://console.cloud.google.com/apis/credentials/consent
   - "Publish App" → "Prepare for verification"
   - Upload demo video, fill out the long form
   - Submit
   - Email volleys with the verification team for ~6 weeks

### Plan
- Get to 50+ TestFlight users using Gmail import in test mode
- Use that real usage to write the demo video
- Submit for verification when you're confident the parsers work for real receipts
- Keep iterating in test mode while verification runs

---

## Operational notes

### When parsers miss receipts

The parsers in `gmail-import/index.ts` are deliberately conservative — they only emit a visit when the regex matches confidently. If a tester's Gmail returns 200 messages and we only import 50, the other 150 either:
- Are from senders we don't recognize
- Have an unusual subject format we haven't seen yet

**To debug:** in Supabase SQL editor, run:
```sql
select count(*), event from analytics_events
where event like 'gmail_%' and user_id = '<test-user-id>'
group by event;
```

(Add tracking calls in the edge function as you tune.)

### Re-scan cadence

Right now the user has to manually tap "Refresh" in Settings to re-scan. To make this automatic, schedule the gmail-import function via pg_cron (similar to `0017_sunday_wrapped_cron.sql`):

```sql
select cron.schedule(
  'palate_gmail_weekly_rescan',
  '0 12 * * 1',  -- Mondays at noon UTC
  -- iterate over connected users + call edge function for each
  $cron$ ... $cron$
);
```

Skip this until you have signal that users want it.

### Cost

- Gmail API: free, generous quotas (1 billion units/day; each scan is ~100 units)
- Google Places lookups for restaurant resolution: existing budget ($200/mo free credit)
- Edge function execution: Supabase free tier covers it

### Privacy posture (matters for verification)

What we store:
- `gmail_tokens` — refresh token (encrypted at rest by Postgres) + email
- `visits` — restaurant + timestamp + import_external_id (the Gmail message ID, used for dedup)

What we DON'T store:
- Email subjects, bodies, or raw content
- Sender lists or contact info
- Anything not directly related to a restaurant visit

This is the right posture for verification — Google reviewers care most about minimal scope and transparent data flow.

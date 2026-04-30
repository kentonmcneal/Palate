# Palate — Setup Guide for a Non-Technical Founder

You don't need to be a developer to follow this. You will be copying, pasting, and clicking. I'll tell you exactly what to do.

**Time required:** ~3 hours start to finish if nothing goes wrong.

**What you'll have at the end:**

- A live landing page on the internet at `palate.vercel.app` (or your own domain)
- A working iPhone app you can install on your own phone via Expo Go
- A real database holding real users and visits
- A clear path to TestFlight and the App Store

---

## Part 0 — Install the tools you need (one time, ~30 min)

You need these installed on your Mac. (If you're on Windows, this still works but the iOS testing is harder; I'll flag those steps.)

### 0.1 Install Homebrew

Homebrew is a tool that installs other tools. Open the **Terminal** app (press Cmd+Space, type "Terminal", hit Enter). Paste this and hit Enter:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

It'll ask for your Mac password. Type it (you won't see the characters appear — that's normal) and hit Enter. Wait until it finishes (a few minutes).

When done, it'll print 2-3 lines under "Next steps". Copy and run those exact lines. Then run:

```bash
brew --version
```

If you see a version number, you're good.

### 0.2 Install Node.js and Git

```bash
brew install node git
```

Verify:

```bash
node --version    # should print v20 or higher
git --version     # should print a version
```

### 0.3 Install the Expo Go app on your iPhone

Open the App Store on your phone. Search **Expo Go**. Install it. We'll use it to run the Palate app without going through the App Store.

### 0.4 Install VS Code (the code editor)

Download from https://code.visualstudio.com and install it like any other Mac app. You'll use this to peek at code and edit environment variables.

### 0.5 Get the project on your computer

Save the `palate/` folder I generated somewhere you'll remember. I suggest `~/Code/palate`. In Terminal:

```bash
mkdir -p ~/Code
mv ~/Downloads/palate ~/Code/palate    # adjust if it's elsewhere
cd ~/Code/palate
```

From now on, when I say "open Terminal in the project folder," I mean run `cd ~/Code/palate` first.

---

## Part 1 — Create the accounts you need (~20 min)

You need accounts on these services. They're all free to start.

### 1.1 Supabase (database + auth)

1. Go to https://supabase.com and click **Start your project**.
2. Sign up with GitHub or email.
3. After signup, click **New project**.
4. Name it `palate`.
5. **Database password:** click "Generate a password". **Copy it and save it somewhere safe** (1Password, Notes, anywhere). You'll need it later.
6. Region: pick the one closest to you (e.g., `us-east-1` if you're on the East Coast).
7. Click **Create new project**. It takes about 2 minutes to provision.

While that's spinning up, do step 1.2.

### 1.2 Google Cloud (Places API)

1. Go to https://console.cloud.google.com and sign in with a Google account (your personal one is fine).
2. Top-left, click the project dropdown → **New Project**.
3. Name it `palate`. Click **Create**.
4. Once created, switch to it (top-left dropdown).
5. **You must add a billing account.** Google requires it even for free-tier APIs. Click the menu (☰) → **Billing** → **Link a billing account** → add a card. They give you $200/month free for Maps APIs and your usage will be far below that.
6. Now enable the API: menu (☰) → **APIs & Services** → **Library** → search for **Places API (New)** → click it → **Enable**.
7. Now create a key: menu (☰) → **APIs & Services** → **Credentials** → **Create credentials** → **API key**. Copy the key it shows. **Save it somewhere safe.**
8. Click the key in the list → **Edit API key** → under **API restrictions**, choose **Restrict key** → tick **Places API (New)** → **Save**. (We'll add referrer restrictions later when we know our domain.)

### 1.3 Vercel (hosts the landing page)

1. Go to https://vercel.com and sign up with GitHub.
2. That's it for now. We'll deploy in Part 5.

### 1.4 Expo / EAS (builds the app)

1. Go to https://expo.dev and sign up.
2. Save your username and password.

### 1.5 GitHub (where your code lives)

1. Go to https://github.com and sign up if you don't have one.
2. Click the **+** top-right → **New repository**.
3. Name: `palate`. Keep it **Private**. Click **Create repository**.
4. **Don't** add a README — we already have one. Leave the page open; you'll see instructions for pushing existing code. We'll do that in Part 7.

### 1.6 (Optional, can skip for now) Apple Developer account

You only need this when you're ready to test on TestFlight or submit to the App Store. It costs $99/year and takes 24-48 hours to activate. **Start it now if you want to test on a real iPhone soon.**

Go to https://developer.apple.com/programs and click **Enroll**.

---

## Part 2 — Set up the Supabase database (~15 min)

Your project should be done provisioning by now. Open it.

### 2.1 Run the schema

1. In your Supabase project, click the **SQL Editor** icon in the left sidebar (looks like a database with `>_`).
2. Click **+ New query**.
3. Open `supabase/01_schema.sql` from this project in VS Code. Copy the entire file.
4. Paste it into the Supabase SQL Editor.
5. Click **Run** (bottom-right). You should see "Success. No rows returned."

### 2.2 Run the policies

1. New query.
2. Open `supabase/02_policies.sql`. Copy/paste/Run.

### 2.3 Run the helper functions

1. New query.
2. Open `supabase/03_functions.sql`. Copy/paste/Run.

### 2.4 Configure Auth

1. Left sidebar → **Authentication** → **Providers**.
2. **Email** is on by default. Good.
3. **Google:** click it, toggle on. To get the credentials, follow the link Supabase shows ("How to set up Google OAuth"). For MVP you can skip this and come back later — magic-link email is enough to start.
4. **Apple:** same. Skip for now; we'll wire it up before App Store submission.

### 2.5 Get your API keys

1. Left sidebar → **Project Settings** (gear icon) → **API**.
2. Copy these two values into a Note for now:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **anon public key** (a long `eyJ...` string)
3. Also copy the **service_role key** but never share or commit this one — it's an admin key.

---

## Part 3 — Wire up the Places API proxy (~15 min)

We do **not** put the Google API key in the mobile app. Instead, the app calls our Supabase Edge Function, which calls Google. This protects the key.

### 3.1 Install the Supabase CLI

In Terminal:

```bash
brew install supabase/tap/supabase
supabase --version
```

### 3.2 Log in and link

```bash
cd ~/Code/palate
supabase login
```

It opens a browser, authorize, come back to Terminal.

```bash
supabase link --project-ref YOUR_PROJECT_REF
```

Your `YOUR_PROJECT_REF` is the part of your Supabase URL between `https://` and `.supabase.co`. So if your URL is `https://abcdefgh.supabase.co`, your ref is `abcdefgh`.

### 3.3 Set the Google API key as a secret

```bash
supabase secrets set GOOGLE_PLACES_API_KEY=paste-your-google-key-here
```

### 3.4 Deploy the edge function

```bash
supabase functions deploy places-proxy --no-verify-jwt
```

Wait — it should say "Deployed Function places-proxy". Note: we use `--no-verify-jwt` because the function checks auth itself in a way that works even before we've fully integrated.

Actually, change of plan: keep JWT verification on. Re-run:

```bash
supabase functions deploy places-proxy
```

The function code in `supabase/edge-functions/places-proxy/index.ts` reads the user's JWT to know who is calling, so we want Supabase to verify it.

---

## Part 4 — Run the landing page locally (~10 min)

```bash
cd ~/Code/palate/landing
npm install
```

Wait for that to finish (a couple minutes the first time).

Now create your environment file. Copy the example:

```bash
cp .env.local.example .env.local
```

Open `.env.local` in VS Code (`code .env.local`) and paste your Supabase URL and anon key. Save.

Run it:

```bash
npm run dev
```

It'll print `Local: http://localhost:3000`. Open that in your browser. You should see the Palate landing page. Type an email into the waitlist form and submit — go to your Supabase dashboard, click **Table Editor**, click `waitlist`, and you should see your email there.

Press `Ctrl+C` in Terminal to stop the dev server.

---

## Part 5 — Deploy the landing page to Vercel (~10 min)

### 5.1 Push to GitHub

In Terminal at the project root:

```bash
cd ~/Code/palate
git init
git add .
git commit -m "Initial commit"
```

Now follow the instructions GitHub showed you. They look like:

```bash
git remote add origin https://github.com/YOUR_USERNAME/palate.git
git branch -M main
git push -u origin main
```

If it asks for a username and password, use your GitHub username and a **personal access token** (Settings → Developer settings → Personal access tokens → Generate new) instead of your password. Save the token.

### 5.2 Import to Vercel

1. Go to https://vercel.com/new.
2. Click **Import** next to your `palate` repo.
3. **Root Directory:** click **Edit** → select `landing` → **Continue**.
4. **Environment Variables:** add the same two from `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
5. Click **Deploy**.

After 1-2 minutes you have a live URL. Click **Visit**. You're online.

You can connect a custom domain later under **Project Settings → Domains**.

---

## Part 6 — Run the mobile app (~20 min)

```bash
cd ~/Code/palate/mobile
npm install
```

This takes longer than the landing page — go get coffee.

When it's done, copy the env file:

```bash
cp .env.example .env
```

Open `.env` in VS Code and paste in your Supabase URL and anon key. Save.

Start the app:

```bash
npx expo start
```

A QR code appears in Terminal. **On your iPhone:** open the **Camera** app, point it at the QR code, tap the notification — it opens in Expo Go and the Palate app loads.

You should see the welcome screen. Walk through onboarding, sign in via magic-link email, and explore the tabs. The app uses **foreground location** — when you tap "Check now" on Home, it asks where you are and looks up nearby restaurants.

When you want to stop, press `Ctrl+C` in Terminal.

---

## Part 7 — Day-2 ops

### Adding Apple Sign-In

This requires:

1. An Apple Developer account ($99/yr).
2. Creating a "Service ID" and a "Key" in your Apple Developer account.
3. Pasting the Service ID, Team ID, Key ID, and key contents into Supabase Authentication → Providers → Apple.
4. Adding a small chunk of native code (`expo-apple-authentication`) — already wired in `mobile/lib/auth.ts`, just needs the Supabase side configured.

I'll give you a separate doc when you tell me you're ready. For MVP testing, magic-link email is enough.

### Putting the app on TestFlight

When ready:

```bash
cd ~/Code/palate/mobile
npm install -g eas-cli
eas login
eas build --platform ios --profile preview
```

EAS Build takes ~20 minutes. You'll get a link to download a build, and you can upload it to TestFlight from your Apple Developer account.

### Adding background location (v1.1)

Once you have ~10 real users on TestFlight using foreground detection, we add:

- `expo-task-manager` + `expo-location` background updates
- iOS "Always" permission ask (a separate, second prompt — can't ask both at once)
- `expo-notifications` for the "Did you eat at X?" prompt as a push
- App Store privacy nutrition label and a beefy justification screen for review

This is its own milestone. Don't try to ship it on day one.

---

## Testing checklist

Before you tell anyone about the app:

- [ ] Landing page loads, waitlist signup writes to `waitlist` table
- [ ] Mobile app loads in Expo Go
- [ ] Magic-link email login works (you got the email and tapping the link signed you in)
- [ ] Onboarding screens flow correctly and asking permission triggers iOS dialog
- [ ] Home → "Check now" finds at least one nearby restaurant when you're outside
- [ ] Tapping "Yes I'm eating here" creates a row in the `visits` table
- [ ] Manual add flow lets you search and save a restaurant
- [ ] Wrapped tab generates a card after you have at least one visit
- [ ] Settings → Delete all visit history empties the `visits` table for your user
- [ ] Settings → Delete account removes your row from `profiles` (RLS confirmed)

## Deployment checklist

Before sharing publicly:

- [ ] Replace placeholder text in `landing/app/privacy/page.tsx` and `landing/app/terms/page.tsx` with a real privacy policy and ToS (use Termly.io ~$10/mo or a lawyer)
- [ ] Set up a custom domain on Vercel (e.g. `palate.app`)
- [ ] In Google Cloud, restrict the API key by HTTP referrer to your Vercel domain (we don't actually use the key on the web, but defense-in-depth)
- [ ] Apple Developer account active
- [ ] App icon and splash screen replaced (see `mobile/assets/`)
- [ ] App Store screenshots prepared (5 per device size)
- [ ] App Store privacy nutrition label filled out (Apple will ask)

---

## When something breaks

- **`npm install` fails:** make sure Node is v20+. Run `node --version`. If lower, `brew upgrade node`.
- **Expo QR code won't scan:** your phone and Mac must be on the same Wi-Fi. Or run `npx expo start --tunnel` (slower but works across networks).
- **Supabase queries fail:** open Supabase Studio → SQL Editor → check the error. 90% of the time it's a missing RLS policy or wrong env var.
- **Places API returns nothing:** check Google Cloud → APIs & Services → Credentials → your key is enabled for Places API (New). And check that the edge function logs (`supabase functions logs places-proxy`) don't show an error.
- **Stuck:** check the file `docs/troubleshooting.md` (which I'd write next if you tell me you hit a wall).

That's it. Take it one part at a time.

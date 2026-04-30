# TestFlight — Day 1 walkthrough

When Apple sends "Welcome to the Apple Developer Program," follow this in order.
~90 minutes of clicking + ~25 minutes of EAS build time.

---

## Prerequisites (do these while waiting for Apple)

- [x] Apple Developer enrollment paid
- [ ] EAS CLI installed: `npm install -g eas-cli`
- [ ] Signed into EAS: `eas login` (uses your Expo account from earlier)
- [ ] You can see your Expo account at https://expo.dev/

---

## Step 1 — Create the App in App Store Connect (10 min)

1. Go to https://appstoreconnect.apple.com → **My Apps** → **+** (top-left) → **New App**
2. Fill in:
   - **Platforms**: iOS
   - **Name**: `Palate`
   - **Primary Language**: English (U.S.)
   - **Bundle ID**: select `app.palate.ios` from dropdown
     - If it's not in the dropdown: go to https://developer.apple.com/account/resources/identifiers
       → **+** → App IDs → App → Continue → Description: `Palate iOS` → Bundle ID: `app.palate.ios` → Continue → Register
     - Then come back to App Store Connect and refresh
   - **SKU**: `PALATE001`
   - **User Access**: Full Access
3. Click **Create**

---

## Step 2 — Wire EAS to your Apple account (5 min)

In Terminal:

```bash
cd "/Users/kentonmcneal/Claude Code/Palate/mobile"
eas init
```

When prompted:
- **Create new project?** → Yes (Expo will give it a project ID and write it into `app.json`)
- **Slug** → `palate` (matches what's already in app.json)

This sets `extra.eas.projectId` in `app.json` automatically. Commit + push that change.

---

## Step 3 — Set up iOS credentials (5 min)

```bash
eas credentials
```

Select:
- **Platform** → iOS
- **Profile** → preview
- **Build credentials** → Set up a new build credentials configuration

EAS will ask if it can manage your Apple credentials automatically. Say **yes**.
Sign in with your Apple ID — EAS will:
- Generate a Distribution Certificate
- Generate a Provisioning Profile for `app.palate.ios`
- Store everything in EAS's secure store (you don't manage `.p12` files)

This is a one-time setup. Future builds just work.

---

## Step 4 — Run the first build (1 click + 25 min wait)

```bash
eas build --platform ios --profile preview
```

EAS will:
1. Upload your code to their build servers
2. Run `pod install` and the iOS native build
3. Sign with the cert from Step 3
4. Email you when done (~25 min)

You can watch progress at https://expo.dev/accounts/<your-username>/projects/palate/builds

When it finishes, you'll have a `.ipa` file with a Download link.

---

## Step 5 — Submit to TestFlight (5 min)

```bash
eas submit --platform ios --profile production --latest
```

When prompted:
- **Apple ID email** → your Apple Developer email
- **App-specific password** → generate at https://appleid.apple.com → Sign-In and Security → App-Specific Passwords → "+"
- **App Store Connect App ID** → it'll list your apps; pick Palate
- **Apple Team ID** → it'll auto-detect

EAS uploads the build to App Store Connect. Apple processes it (~5-15 min).

---

## Step 6 — Set up the TestFlight listing (10 min)

In App Store Connect → **Palate** → **TestFlight** tab:

### Test Information (left sidebar)
- **Beta App Description**: paste from `APP_STORE.md` §4
- **Feedback Email**: hello@palate.app (or your personal)
- **Marketing URL**: https://palate.app
- **Privacy Policy URL**: https://palate.app/privacy

### Once your build appears under "iOS Builds":
- Click the build number → **Manage** → "Yes, my build uses encryption" → **No, only standard system encryption**
- Add **What to Test** notes (use §9 "What's New" content from APP_STORE.md)

### Internal testers (skip Apple review)
- Left sidebar → **Internal Testing** → **+** → create a group
- Add yourself as an internal tester
- Add the build to the group → instant install

You'll get an email within a minute. Open on your iPhone → install via TestFlight app.

### External testers (requires Apple review, ~24-48hr first time)
- Left sidebar → **External Testing** → **+** → create a group
- Add the build → submit for review
- Once approved, you get a public link like `testflight.apple.com/join/abc123`
- Send the link to friends — anyone can install (cap: 10,000)

---

## Step 7 — Send the link

Once your external group is approved, you have a real public install link.

**Suggested first text:**
> "Hey — I built an app I want you to try. It's called Palate. One tap when you arrive somewhere you're eating, and every Sunday you get a little personality reveal of what your week looked like. Privacy-first, no public profile. iOS only for now. Want in? [TestFlight link]"

Send to 5-10 people first. Watch for:
- Did they make it through onboarding?
- Did they log a visit?
- Did they get their first Wrapped?
- What confused them?

Don't add features for the first week. Just watch.

---

## Common issues

| Problem | Fix |
|---|---|
| `eas init` says "project already exists" | You're set up, skip Step 2 |
| Build fails on `pod install` | Usually a transient EAS issue — retry the build |
| TestFlight shows "Processing" forever (>1hr) | Check email — Apple sometimes flags missing privacy policy URL or icon issues. Fix in App Store Connect, build won't need rebuild |
| External tester review rejected | Read their notes carefully. Most common: missing privacy policy URL, demo account that doesn't work, or a crash on first launch. Fix → resubmit. |

---

## What to ping me when you hit a snag

Just paste the error or screenshot. Most TestFlight issues have a known fix — usually a checkbox in App Store Connect.

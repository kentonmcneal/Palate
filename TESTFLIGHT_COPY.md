# TestFlight / App Store Connect — paste-ready copy

Everything App Store Connect asks for during TestFlight setup and Beta App
Review. Fill the `<>` placeholders, paste, done.

---

## Beta App Description
*(TestFlight → your build → Test Details. Testers see this in the TestFlight app.)*

```
Palate turns your real eating life into a taste identity.

Open the app after a meal out and it detects where you were, so logging a visit
takes one tap instead of a form. Over a few weeks it builds a profile of how you
actually eat — not how you'd describe it — and every Sunday it gives you a
Wrapped: a read on your week, your patterns, and what they say about you.

It also recommends places based on that profile rather than on star ratings, and
deliberately filters out national chains so Discover surfaces independents.

This is an early beta. Some things will be rough. Tell me when they are.
```

---

## What to Test
*(The single most-read screen — it appears right above the install button.)*

```
Use it like you normally would for a few days: go out to eat, open the app
afterward, log what you ate.

Worth poking at specifically:
• The auto-detect prompt when you open the app after a meal — does it find the
  right place?
• Discover — do the recommendations feel like you, or generic?
• Your Sunday Wrapped.
• Share cards — do they render correctly when you share one?

Found something broken, confusing, or great?
→ Settings → Share feedback (screenshots welcome)

That goes straight to me. You can also send TestFlight feedback by taking a
screenshot and tapping Share, but the in-app one gives me more context.
```

---

## App Review Information — demo account
*(Required for external review. Palate's login is `signInWithOtp` — email code
only, no password — so the reviewer must be able to READ the inbox the code is
sent to. Use a dedicated throwaway email account for this; do not use a personal
inbox, and do not install an auth trigger in production to fake a fixed code.)*

**Sign-in required:** Yes
**User name:** `<review inbox address, e.g. palate.review@gmail.com>`
**Password:** `<that inbox's password — Apple stores this securely>`

**Notes:**
```
Palate signs in with a one-time code emailed to you — there is no app password.

The credentials above are for a dedicated email account created for review. Use
them to read the code:

  1. On the Palate sign-in screen, enter the email address above.
  2. Tap "Send code."
  3. Sign in to that email account (webmail, credentials above) and open the
     message from Palate.
  4. Enter the 6-digit code in the app.

The code expires after 1 hour and a new one can be requested every 60 seconds.

This account is pre-populated with visit history so the recommendation engine,
profile, and weekly Wrapped all have data to display.

Location: Palate requests location ONLY while the app is in use, to detect which
restaurant you may be at when you open it. There is no background location
tracking, no geofencing, and no background location mode in the app.

User-generated content: the social feed supports reporting posts and blocking
users (••• menu on any post, and on user profiles). Blocked accounts are
manageable in Settings.
```

---

## Contact / support

- **Support email:** `hello@palate.app`
- **Privacy policy URL:** `https://palate-zm29.vercel.app/privacy`
- **Terms URL:** `https://palate-zm29.vercel.app/terms`

> ⚠️ Use the Vercel URLs, not `palate.app` — that domain does not resolve, and
> Apple hard-blocks a broken privacy URL.

---

## Message to send friends (internal testers)

```
Been building this — it's called Palate. It turns where you actually eat into a
taste profile, and gives you a Wrapped every Sunday.

It's on TestFlight. Send me the email tied to your Apple ID and I'll add you —
you'll get an invite, then install TestFlight and it's one tap.

Fair warning: early beta, stuff will break. If something's off there's a feedback
button in Settings — use it liberally, that's the whole point of this round.
```

---

## Encryption question

Already answered in code — `ITSAppUsesNonExemptEncryption: false` is set in
`mobile/app.json`, so the build clears export compliance automatically. If
App Store Connect asks anyway: **"No, only standard system encryption."**

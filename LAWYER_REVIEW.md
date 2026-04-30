# Palate — Pre-launch Legal Review Punch List

**Audience:** outside counsel reviewing our public privacy policy, terms of
service, and adjacent compliance posture before we ship Palate to the App
Store.

**Authored by:** the Palate engineering team. We are not lawyers — this memo
is meant to give you the engineering ground truth so you can advise us
quickly without having to dig through the codebase.

**Status of the public docs as of this memo:**
- `landing/app/privacy/page.tsx` — drafted, footer reads
  "placeholder pending lawyer review."
- `landing/app/terms/page.tsx` — drafted, footer reads
  "placeholder pending lawyer review."

---

## 1. Context

Palate is a privacy-first iOS app that quietly notices when a user is at
a restaurant, café, food truck, or drive-thru, asks them with a single tap
whether they're eating there, and on Sunday morning surfaces a "Wrapped" of
their week — visit count, top spots, a personality archetype.

The company is US-incorporated (Delaware C-corp; California operating
office). We plan to launch in the United States first, then the United
Kingdom and the European Union. The app is currently in closed beta via
TestFlight; the public landing site is at https://palate.app and is the
subject of this review.

**Data we collect, end-to-end:**

- Email address (for account sign-up via magic link).
- Restaurant identifier (a Google Places `place_id`), once per confirmed
  visit, with a server-side timestamp and an inferred meal slot
  (breakfast / lunch / dinner).
- Latitude / longitude. **Transient only.** We send the user's lat/lng
  to our server to call Google Places Nearby Search, then discard. Raw
  coordinates are never written to durable storage tied to a user
  account in v1.

**What we explicitly do not do:**

- No advertising, no ad SDKs, no third-party advertising identifiers.
- No data sales. No data brokering.
- No social features — no profiles, no friends, no comments, no likes.
- No third-party analytics SDKs in the iOS app itself. The marketing
  landing site uses one privacy-friendly analytics provider (currently
  configurable between Plausible, Umami, or PostHog — see
  `landing/lib/analytics.ts`).

The product is a single-player tool. There is no UGC and there is no
mechanism for one user to see another user's data.

We would like a launch-blocking review of (a) the two public legal
documents, (b) our cookie / consent posture, and (c) any obvious gaps in
our compliance posture for the US launch and the subsequent EU/UK launch.

---

## 2. Privacy policy items to verify

The current draft lives at `landing/app/privacy/page.tsx`. Section
references below match the `<h2>` numbering in the rendered page.

### § 1 — "What we collect"

Current language enumerates: email, restaurant identifier (Google Places),
timestamp, inferred meal type, and a transient lat/lng for the Nearby
Search call.

- **Question:** is the enumeration complete and specific enough? We
  considered listing the iOS device model (we read it for crash reports)
  and whether the user has location permission granted (we store this as
  app state). Should those be disclosed even though they don't leave the
  device?
- **Question:** do we need to call out IP address as something
  Supabase + our hosting provider see at the network layer even though
  we don't log it ourselves?

### § 2 — "What we don't collect"

Currently asserts: no name, phone, photos, contacts, calendar, microphone,
other-app activity, device fingerprinting, or third-party advertising /
behavioral SDKs.

- **Action item for us:** before this can be signed off as truthful, we
  owe an engineering audit confirming each negative is in fact correct
  in shipping code (iOS bundle + landing site bundle). We will produce
  this audit as a separate document; we want you to flag any phrasing
  that is unsafe to claim categorically vs. with qualifiers.
- **Question:** "we don't fingerprint your device" — is that defensible
  given Apple still gives us an `IDFV` and Supabase / Vercel see TLS
  fingerprints? We've never exploited either, but we'd like to know if
  the language needs to be softened.

### § 4 — "Who we share it with" / Subprocessors

Listed in the draft as Supabase (database) and Google (Places API).
The landing page mentions Plausible, but we have just made the analytics
provider pluggable: at launch the production env var will be exactly one
of `NEXT_PUBLIC_PLAUSIBLE_DOMAIN`, `NEXT_PUBLIC_POSTHOG_KEY`, or
`NEXT_PUBLIC_UMAMI_WEBSITE_ID`. We also use Vercel for hosting and (likely)
a transactional email provider — Resend or Postmark — to send the magic
links.

- **Question:** do we need a signed Data Processing Agreement (DPA) with
  each subprocessor? Specifically: Supabase, Google Cloud (Places),
  Vercel, our email provider, and the chosen analytics provider. Which
  of these are we already covered for via standard ToS, and which need
  bespoke contracts?
- **Question:** are we obligated to publish the full subprocessor list
  on the public site (à la a "Trust" page), or is naming them in the
  privacy policy sufficient for our scale and our user base?
- **Question:** if we change subprocessors after launch, what notice
  period (if any) do we owe users under GDPR / CCPA / our own ToS?

### GDPR readiness (EU / UK launch — phase 2)

We do not plan to make Palate available in the EU/UK at the very first
launch, but we will within the first 6–12 months. The current policy
draft does not yet articulate:

- **Lawful basis** for processing (likely "performance of a contract"
  for the core service plus "legitimate interests" for the analytics —
  please confirm).
- **Data subject rights**: explicit enumeration of access, rectification,
  erasure, restriction, portability, objection, and the right to lodge
  a complaint with a supervisory authority.
- **Data export** is already documented in § 6 of the draft (JSON export
  on email request, 30-day SLA). Please flag if the SLA needs tightening
  (GDPR is one month, extendable by two more months for complex
  requests).
- **Retention period** for visit data, locations (transient — but flag
  if our claim to that effect is sufficient), and account data after
  deletion (the draft says "permanent deletion within 30 days" of
  termination — please confirm that's safe under GDPR).
- **International transfers**. Supabase offers EU-region projects. If we
  launch in the EU we will provision a separate EU project; please
  advise whether routing EU users to a US project under SCCs is
  acceptable for the interim or whether we must go EU-first from day
  zero of the EU launch.

### CCPA / CPRA (California)

Even though we do not sell data and have no advertising, the CPRA's
expanded definition of "share" includes some forms of analytics if they
involve cross-context behavioral advertising. None of our three analytics
options do that today, but:

- **Question:** do we still need to surface a "Do Not Sell or Share My
  Personal Information" link in the footer? Our reading says yes if any
  reasonable interpretation could classify our analytics traffic as
  "sharing." Please confirm.
- **Question:** the policy is silent on the explicit CCPA categories
  enumerated in Cal. Civ. Code § 1798.140. Should we add a CCPA-specific
  block listing, for each enumerated category, whether we collect it?
- **Question:** CPRA-specific user rights (right to correct, right to
  limit use of sensitive personal information). Geolocation precise to
  fewer than 1850 ft is "sensitive personal information" under CPRA —
  the lat/lng we send to Google Places is more precise than that, even
  if we discard it. Does that trigger the limitation right even though
  the data is transient?

### COPPA — minimum age

Terms § 1 sets the minimum age at 13 (US COPPA threshold). The privacy
policy § 8 echoes "not directed at children under 13."

- **Question:** in the EU, the GDPR-K floor for some countries is 16
  (member states can lower it to 13). If we launch EU-wide, do we set a
  uniform 16+ for EU traffic, or 13+ with parental consent, or member-
  state-specific gates? What's the practical recommendation?
- **Question:** the App Store age rating is currently set to 4+. If we
  raise the policy floor to 13+ (or 16+ in EU), does our App Store age
  rating need to match?

### § 8 — Children's data deletion process

The current language: "If you believe we have, email privacy@palate.app
and we will delete it." That's a reactive process — we have no proactive
age-verification gate beyond a check-the-box at sign-up.

- **Question:** is that compliant with COPPA's "actual knowledge"
  standard, given we don't ask for date of birth?
- **Question:** is the same flow compliant with GDPR-K, which is more
  prescriptive about parental consent verification than COPPA?
- **Question:** do we need to formally appoint someone responsible for
  children's privacy requests (the way COPPA expects an "operator
  contact"), or is the privacy@palate.app inbox sufficient?

---

## 3. Terms of service items to verify

The current draft lives at `landing/app/terms/page.tsx`.

### § 4 — "The beta"

> "We will give 30 days notice before any change that meaningfully
> reduces your access to your data, and we will always provide a final
> export."

- **Question:** is "30 days notice" something we want to be contractually
  bound to? It feels right for trust-building but it ties our hands if
  we discover a security issue that needs immediate remediation. Should
  we add a "save in cases of security or legal necessity" carve-out?
- **Question:** "always provide a final export" — what's our minimum
  obligation under GDPR / CPRA, and is our promise stricter than
  required? If we want to keep it, that's fine — we just want to know.

### § 5 — Pricing

> "Any paid features will be announced in-app at least 30 days before
> launch and will never apply retroactively."

- **Question:** is "never apply retroactively" enforceable as written,
  and is it something we want? Concretely: if a feature has been free
  in beta and we move it behind a Pro paywall after general availability,
  is the promise here triggered? We probably want users who used the
  feature in beta to keep using it free; the language could be sharpened
  to say exactly that.

### § 9 — Limitation of liability

> "Our total liability is limited to the greater of (a) the amount you've
> paid us in the last 12 months, or (b) US$50."

- **Question:** is the $50 floor enforceable in all 50 states? We've
  heard some states (notably California, New Jersey) have caselaw or
  statute limiting how low this floor can go, especially when the user
  has paid the company nothing.
- **Question:** is the carve-out language standard enough? We do not
  currently exclude liability for gross negligence, willful misconduct,
  or fraud — we should probably state that explicitly.

### § 10 — Governing law

> "These terms are governed by the laws of the State of California, USA.
> Disputes will be resolved in San Francisco County, CA."

- **Question:** there is currently no mandatory arbitration clause and
  no class-action waiver. Do you recommend we add them? We have a
  philosophical preference for not forcing arbitration, but we
  understand it materially affects our litigation exposure.
- **Question:** if we add arbitration, do we use AAA, JAMS, or a small-
  claims carve-out? We've seen consumer-friendly versions and we'd
  rather adopt one of those if we add it at all.

### Mandatory arbitration

Same question, broken out because it's a meaningful policy decision:
**should we add one at all?** What is the right answer for a beta-stage
consumer iOS app with a small US user base?

### § 11 — Contact

A single email: hello@palate.app.

- **Question:** as a Delaware C-corp doing business in California, do we
  need to publish a registered agent address or a California-specific
  contact for legal service? Is that handled at the corporate-formation
  level (Delaware registered agent) or do we owe a public-facing one
  too?
- **Question:** for App Store compliance, Apple requires a public
  support URL. We currently route to mailto. Is that OK?

---

## 4. Cookies & consent

### Current state

The landing site at https://palate.app currently:

- Sets **zero** cookies.
- Sets **no** localStorage / sessionStorage entries (the cookie banner is
  intentionally in-memory only — see
  `landing/components/CookieBanner.tsx`).
- Loads at most one analytics script depending on env vars:
  - **Plausible** is cookieless by design.
  - **Umami** is cookieless by default (we have not enabled the optional
    cookies).
  - **PostHog**, when configured, is initialized with
    `persistence: 'memory'` (see `landing/components/AnalyticsBoot.tsx`),
    which suppresses cookies and localStorage.

This is a deliberate architectural choice: "no cookies" is a stronger
privacy posture than "cookies + a banner" and avoids the entire CMP
question for the first launch.

### EU launch implications

Once we open EU traffic, the ePrivacy Directive (cookie law) and GDPR
together create a stricter regime even for cookieless analytics — IP
addresses and device fingerprints can themselves be personal data.

- **Question:** is our cookieless posture sufficient for EU launch, or
  do we still need a real Consent Management Platform (Cookiebot,
  Iubenda, OneTrust, etc.) to gate the analytics script?
- **Question:** if a CMP is required, which of the three providers
  do you recommend for our scale (a few hundred MAU at launch)? We do
  not want to integrate a CMP if we can avoid it.
- **Question:** the in-memory CookieBanner currently labels the
  analytics as "privacy-friendly." If we add PostHog with
  `persistence: 'memory'`, is that label still accurate for EU users?

### Cookie audit

As of this memo (port from static HTML to Next.js complete), the
production landing site sets **zero** cookies in any browser we've
tested (Safari 17, Chrome 124, Firefox 125), with each of the three
analytics providers. We will rerun this audit immediately before EU
launch and document it for the file.

---

## 5. Trademark / IP

### "Palate" — wordmark

"Palate" is a common English word and the namespace is crowded:
restaurant guides, food blogs, kitchen products, even a defunct wine app.

- **Action item for counsel:** US trademark search, including ITU
  filings and common-law uses in IC 009 (downloadable software) and
  IC 042 (SaaS). We have done a casual `tmsearch.uspto.gov` pass and
  see at least one live registration that could be a problem; please
  do a real one.
- **Question:** do you recommend filing in IC 009 + IC 042 + IC 041
  (entertainment / publishing — for the Wrapped content), or just the
  first two?
- **Question:** EU/UK filings — when do we file? Pre-launch in those
  regions?

### Logo

The mark is a lowercase "p" in white inside a rounded red square. It
was hand-designed, not derived. Still:

- **Action item for counsel:** clearance check on the mark in IC 009.
- **Question:** the App Store icon will use the same mark. Any change
  in clearance scope when filed as a design mark vs. a wordmark?

### Domain

We hold palate.app. We do not hold palate.com (registered to a third
party, no active site). We do not currently feel a need to acquire
.com.

- **Question:** does a defensive-only acquisition strategy expose us to
  trademark dilution risk?

---

## 6. App Store / Privacy Nutrition Labels

Apple's App Store Connect requires us to:

1. Complete the **App Privacy** disclosure (the "nutrition labels"
   shown on the App Store product page).
2. Ship a **Privacy Manifest** (`PrivacyInfo.xcprivacy`) inside the app
   bundle, declaring:
   - Each category of data we collect.
   - The reasons we use any "required reason" APIs (e.g.
   `UserDefaults`, `FileTimestamp`, `SystemBootTime`).
   - Each third-party SDK's privacy manifest must transitively be
     present.

### Current alignment

- We have drafted the App Privacy questionnaire answers; they match the
  draft privacy policy. We will share both with you as a side-by-side
  before submission.
- The Privacy Manifest is not yet finished. We will finish it before
  TestFlight → App Store submission.

### Items for counsel

- **Question:** does the policy as drafted have any claim that
  contradicts the most natural App Privacy answer set? (E.g., we say
  "we don't collect your name" — Apple's category is "Contact Info >
  Name." Stating "Not Collected" is consistent, but we want a second
  pair of eyes.)
- **Question:** if we add PostHog or Umami after launch, does the
  Privacy Manifest need re-submission, or only the App Privacy
  disclosure?

---

## 7. Open questions for the lawyer

Short list of things we'd love a yes/no/it-depends from you on. If
"it depends," what does it depend on?

1. **DPO under GDPR.** Our reading is that a startup of our size with
   no large-scale processing of special categories does not require a
   formal Data Protection Officer. Confirm?
2. **State-by-state US privacy laws.** Beyond CCPA / CPRA, our flows
   are designed to comply with VCDPA (Virginia), CPA (Colorado),
   CTDPA (Connecticut), and UCPA (Utah). All four broadly require the
   same things — privacy notice, right to access, right to delete,
   right to opt out of sale — and we believe our existing flows
   satisfy them, but please flag any state-specific items we're missing
   (e.g. Colorado's universal opt-out signal honoring requirement).
   The newer laws (TX, IA, IN, OR, MT, TN, FL, NJ, DE, NH, KY, MD,
   MN, RI in 2025–2026) — anything we should preemptively comply with?
3. **CAN-SPAM and the waitlist.** Our hero waitlist captures email +
   sends one onboarding email when TestFlight opens. Success message
   reads: "We'll email you when iOS testing opens up. That's the only
   email you'll get." We believe this is CAN-SPAM compliant
   (clear opt-in, transactional purpose, identified sender). Confirm?
4. **Weekly Wrapped emails — separate consent?** The "Wrapped" can
   be sent as a push notification (preferred) or as an email. If we
   add the email path, is the original waitlist opt-in sufficient, or
   do we need a separate explicit consent at the moment we add the
   feature, given the original opt-in was scoped to "we'll email when
   TestFlight opens"?
5. **Data residency.** Any reason we shouldn't run a single Supabase
   project in `us-east-1` for the US launch? We have read that
   California users' data does not need to be stored in California
   under CCPA — confirm?
6. **Children's data deletion.** Section § 8 of the privacy policy is
   reactive (email us, we'll delete). Is that safe under COPPA's
   "actual knowledge" standard, or do we need a proactive age gate at
   sign-up (date of birth or "are you over 13" checkbox)? We'd prefer
   not to ask DOB.
7. **Beta-period disclosures.** Anything we should add to ToS or the
   privacy policy that's specific to the fact that the app is in
   closed beta and not generally available? For example, a "data may
   be wiped without notice" carve-out for the beta period?

---

## 8. Engineering deliverables we owe you

To make your review faster:

- A **subprocessor table** with each vendor, the data they see, the
  region(s), and the contractual basis (DPA in place / standard ToS).
- A **negative-claim audit** — for each "we don't collect X" line in
  the policy, the file/line in our codebase that proves it. We're
  happy to walk you through this on a call.
- A **data flow diagram** for one round trip: user opens app → confirms
  visit → Wrapped email goes out. Including which subprocessor sees
  what at each hop.
- A **CCPA / state-law disclosures table** — what each state requires
  vs. what our policy covers.

We can have all four ready within five business days of your kick-off.

---

## 9. What we are NOT asking for in this pass

To save time and budget, this review is scoped to public-facing legal
documents and adjacent compliance. Out of scope (explicitly, for now):

- Employment / contractor agreements.
- Open-source license review of our dependencies (we will run that
  separately with an SBOM tool).
- Patent strategy.
- Investor / cap table work.
- App Store or Play Store contractual review beyond the Privacy
  Manifest issue.

If you spot something egregious in any of the above while reading the
codebase, we want to hear about it — but we are not retaining you for it
in this engagement.

---

## 10. Timeline

- **Now → +2 weeks:** legal review of privacy + terms drafts. We
  iterate to a finalized version.
- **+2 → +3 weeks:** App Store submission. Privacy Manifest finalized.
- **+3 → +6 weeks:** US launch (closed → public TestFlight expansion,
  then App Store).
- **+3 to +9 months:** EU/UK launch. By that point we want the
  GDPR-readiness items above closed out and a CMP decision made.

The most time-sensitive piece is the public privacy policy and ToS
review, since the landing site already references them and the
TestFlight build links to them.

Thank you. Reply with questions and we'll get you whatever you need.

— the Palate team

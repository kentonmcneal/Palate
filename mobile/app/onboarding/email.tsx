import { Redirect } from "expo-router";
import { GMAIL_OAUTH_ENABLED } from "../../lib/gmail-gate";
import { FORWARDING_LIVE } from "../../lib/receipt-forwarding";

/**
 * The email-import step, late in onboarding on purpose.
 *
 * The activation funnel drops hardest at onboarding -> location, so nothing new
 * goes in front of that. This sits after the location ask, where somebody has
 * already committed, and it is skippable — a cold account with no history is a
 * worse outcome than a slightly longer signup, but not by enough to justify
 * blocking anyone here.
 *
 * SKIPPED ENTIRELY while both import paths are dark. Gmail OAuth is withdrawn
 * (gmail-gate.ts: it showed every user Google's "this app hasn't been
 * verified" wall) and forwarding is waiting on DNS. With neither live, this
 * step sends a brand-new user to a screen whose only content is an apology —
 * a dead stop in the middle of signup, on the flow that already loses two of
 * every three accounts.
 *
 * One condition, so it comes back on its own the moment either path lights up.
 */
export default function OnboardingEmail() {
  if (!GMAIL_OAUTH_ENABLED && !FORWARDING_LIVE) {
    return <Redirect href="/onboarding/privacy" />;
  }
  return <Redirect href={{ pathname: "/import-email", params: { next: "/onboarding/privacy" } }} />;
}

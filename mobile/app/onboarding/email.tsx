import { Redirect } from "expo-router";

/**
 * The email-import step, late in onboarding on purpose.
 *
 * The activation funnel drops hardest at onboarding -> location, so nothing new
 * goes in front of that. This sits after the location ask, where somebody has
 * already committed, and it is skippable — a cold account with no history is a
 * worse outcome than a slightly longer signup, but not by enough to justify
 * blocking anyone here.
 */
export default function OnboardingEmail() {
  return <Redirect href={{ pathname: "/import-email", params: { next: "/onboarding/privacy" } }} />;
}

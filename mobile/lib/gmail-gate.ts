// ----------------------------------------------------------------------------
// gmail-gate.ts — one constant, and no dependencies.
// ----------------------------------------------------------------------------
// Deliberately its own module. gmail.ts imports expo-auth-session and
// expo-web-browser; next-step.ts is pure decision logic with unit tests behind
// it, and making it reach through a native module to read a boolean would drag
// the whole OAuth stack into a jest run that has no business loading it.
// ----------------------------------------------------------------------------

/**
 * Whether to OFFER the OAuth connect flow. Off, deliberately.
 *
 * gmail.readonly is in Google's RESTRICTED scope tier — the top one. Any app
 * requesting it shows the full-page "Google hasn't verified this app / BACK TO
 * SAFETY" interstitial to every single user until it passes OAuth verification
 * AND an annual CASA Tier 2 third-party security assessment (~$540-675/yr,
 * roughly six weeks). No publishing status, test-user list or console setting
 * removes that screen; "Testing" and "In production, unverified" both show it.
 *
 * Shipping an onboarding step that tells a new user their app is unsafe is
 * worse than not having the step. So the offer is withdrawn and receipts come
 * in by forwarding instead (see lib/receipt-forwarding.ts), which needs no
 * Google review, no annual fee, and works for people who are not on Gmail.
 *
 * This is a GATE, not a deletion. Everything below still works: an account
 * that already connected keeps importing, and flipping this to true restores
 * the flow the day verification is worth paying for.
 */
export const GMAIL_OAUTH_ENABLED = false;

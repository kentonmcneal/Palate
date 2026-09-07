// ============================================================================
// share-target.ts — the address on the thing strangers see.
// ----------------------------------------------------------------------------
// The Wrapped story card printed "palate.app" at the bottom, and palate.app
// does not resolve. Checked 2026-09-07: no web record answers, and neither
// does your-palate.com, which serves mail and nothing else. Every share the
// app has ever produced pointed somebody at a dead address.
//
// That matters more here than anywhere else in the product. This card exists
// to be seen by people who do not have the app; the URL is the entire call to
// action, and a beautiful card pointing nowhere is worse than a plain one that
// works.
//
// So the domain lives in one place, and it is the honest one until DNS says
// otherwise. Point palate.app at the Vercel deployment and change this line —
// that is the whole job, and then every share is right at once.
// ============================================================================

/** Printed on the Wrapped story card. Must be somewhere that answers. */
export const SHARE_DOMAIN = "palate-zm29.vercel.app";

/** True once the pretty domain is live. Flip with SHARE_DOMAIN together. */
export const SHARE_DOMAIN_IS_BRANDED = false;

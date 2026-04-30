import { NextResponse } from "next/server";
import { getWaitlistCount } from "@/lib/waitlist";

// Cache the count for 60s on the CDN; serve stale for up to 5 minutes
// while a fresh value is regenerated in the background.
//
// The page itself fetches the count via `getWaitlistCount` directly during
// SSR; this route is kept as a convenience for any client-side polling
// (e.g. from a future "live counter" widget).
export const revalidate = 60;

export async function GET() {
  const count = await getWaitlistCount();
  return NextResponse.json(
    { count },
    {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    },
  );
}

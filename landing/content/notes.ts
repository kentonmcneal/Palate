// ============================================================================
// notes.ts — single source of truth for /notes posts.
// ----------------------------------------------------------------------------
// Stored as TS instead of MDX so we don't need a markdown pipeline yet. When
// the catalogue grows past ~10 posts, swap to MDX with `next-mdx-remote`.
// ============================================================================

export type Note = {
  slug: string;
  title: string;
  /** Plain-text dek shown in lists + meta description. */
  dek: string;
  publishedAt: string; // YYYY-MM-DD
  /** Author display string. */
  author: string;
  readingMinutes: number;
  /** Body as an ordered array of paragraphs (or {h2: ...} headings). Renders verbatim. */
  body: Array<string | { h2: string }>;
};

export const NOTES: Note[] = [
  {
    slug: "fourteen-times",
    title: "I had no idea I'd been to Sweetgreen fourteen times last month.",
    dek: "Why I'm building Palate, and why \"how often\" matters more than \"how good\".",
    publishedAt: "2026-04-30",
    author: "Kenton McNeal",
    readingMinutes: 4,
    body: [
      "Last fall I sat in a friend's kitchen in Manhattan and tried to remember what I'd eaten that week. I got three meals. Maybe four. The week had been seven days long.",
      "When I scrolled my bank statement that night, I counted fourteen Sweetgreen charges in 30 days. Not because I love Sweetgreen. Because it was on the way home, and I'd stopped noticing.",
      { h2: "We measure the wrong things" },
      "Yelp tells me what people think. Resy tells me what to book. Beli tells me how my friends would rank it. None of them tell me what I actually do.",
      "And the thing is — what I actually do is the most honest thing about me. Where I keep going back. What I order without thinking. The line between \"a place I'd recommend\" and \"a place I show up to\" is wide and it tells you everything.",
      { h2: "What Palate is" },
      "Palate is the smallest possible app that answers one question: who are you, the way you eat?",
      "One tap when you arrive somewhere. We notice the rhythm. Every Sunday morning, you get a Wrapped — your week as a personality, not a leaderboard. The Convenience Loyalist. The Café Dweller. The Explorer. Whatever you've been, this week.",
      "No reviews. No followers. No public profile. There's no version of Palate where someone else can see what you ate. That's not a feature, that's the foundation.",
      { h2: "Why now" },
      "Spotify Wrapped works because the data was always there — you just hadn't looked at it. The same is true of food. Your phone already knows what restaurants you walk into. The question was never \"can we do this,\" it was \"will anyone build it without trying to monetize you in the process.\"",
      "I'd rather charge a few dollars than ever sell your data. Beta is free. Long-term, there will always be a free tier.",
      "I'm building this because I want to use it. The waitlist is open. iOS first.",
    ],
  },
];

export function noteBySlug(slug: string): Note | undefined {
  return NOTES.find((n) => n.slug === slug);
}

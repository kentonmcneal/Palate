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
    slug: "no-social-feed",
    title: "Why Palate doesn't have a social feed.",
    dek: "We could've added followers, likes, comments. We didn't. Here's why.",
    publishedAt: "2026-04-30",
    author: "Kenton McNeal",
    readingMinutes: 3,
    body: [
      "Every app I considered before building Palate had the same shape: log a thing, share the thing, see what your friends did, react to it. Yelp. Beli. Instagram. Even Spotify Wrapped — the whole point is the share.",
      "Palate is structurally different. There is no version of it where someone else can see what you ate. Not your followers, not your friends, not the app maker. That's not a feature toggle, that's the foundation.",
      { h2: "What gets lost when food is performed" },
      "When eating becomes a public act, you start picking restaurants for the photo. The bowl that looks good in overhead shots wins over the one you actually wanted. The dim lit speakeasy gets logged; the sad desk lunch doesn't. Within six months you have a beautifully curated profile and no idea what you actually eat.",
      "We've watched this happen to fitness apps, to reading apps, to dating. The thing being measured changes shape to fit the audience watching. Palate refuses to add an audience.",
      { h2: "The math case" },
      "If you let users follow each other, you have to build moderation, content policy, abuse reporting, blocking, comment removal, takedown procedures. You have to hire trust and safety. You have to defend against state actors and bad actors and mid actors. The cheapest part is the feature; the expensive part is what it forces you to become.",
      "We'd rather be a small calm app you trust than a big anxious one you check.",
      { h2: "What you get instead" },
      "A Sunday morning Wrapped, just for you. A personality reveal that feels like a friend reading you. The chance to share if you want — but as a one-shot card, not a profile.",
      "Some users will miss the social. Most won't. The point of Palate isn't comparison. It's clarity.",
    ],
  },
  {
    slug: "the-3800-math",
    title: "The math: 5.9 times a week is $3,800 a year.",
    dek: "Where most of us actually spend our food money — and why we don't notice.",
    publishedAt: "2026-04-30",
    author: "Kenton McNeal",
    readingMinutes: 3,
    body: [
      "The U.S. Bureau of Labor Statistics says the average American eats out 5.9 times per week. Multiply by 52 weeks and you're looking at 307 meals a year outside your kitchen.",
      "Average ticket size for fast casual hovers around $12.50. Sit-down meals push higher. Even at the conservative end, that's $3,800 a year on food someone else made.",
      "Here's the tell: when I ask people how often they eat out, they almost always guess two or three times a week. The real number is twice that. The gap between guess and truth is where Palate lives.",
      { h2: "Why the gap exists" },
      "Most of us underestimate routines because they don't feel like decisions. The morning latte isn't 'eating out' in your head — it's just Tuesday. The salad on the way home isn't a meal — it's defense. The fourth pizza of the month feels like the second.",
      "Our brains compress repetition. We remember the new place, the date night, the trip — not the 14 Sweetgreens. So our self-image stays out of sync with our calendar.",
      { h2: "What the number unlocks" },
      "The point isn't to eat out less. Some people will look at the $3,800 and feel fine — that's their entertainment, their socializing, their mental break. Others will look at it and want to redirect.",
      "Either reaction requires the same thing: knowing the number in the first place. Most apps that try to track this fail because they put the work on you. Palate is one tap when you arrive and a Sunday recap. That's it.",
      "You can't change a pattern you can't see. We're just turning the lights on.",
    ],
  },
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

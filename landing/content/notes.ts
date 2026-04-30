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
    slug: "what-we-wont-build",
    title: "What Palate will never build.",
    dek: "Anti-roadmaps are more honest than roadmaps. Here's everything we're saying no to.",
    publishedAt: "2026-04-30",
    author: "Kenton McNeal",
    readingMinutes: 4,
    body: [
      "Most product roadmaps are aspirational. They tell you what's coming. We've found those documents are less interesting than the opposite — what we're explicitly *not* going to build, and why.",
      "Here is the anti-roadmap. Bookmark it. Hold us to it.",
      { h2: "We will never have a public profile" },
      "There is no version of Palate where someone else can see what you ate. Not your followers, not your friends, not the company. The whole identity layer collapses if it becomes performative. The day we add a public profile is the day Palate stops being honest.",
      { h2: "We will never have ratings or reviews" },
      "If we let you rate places, you'll start picking restaurants you'd be willing to rate well. The behavior shifts to fit the audience. We don't want your opinion of the burger. We want to know whether you went back for it.",
      { h2: "We will never sell your data" },
      "Every food app gets this offer eventually. Restaurants will pay to know who's nearby and ready to eat. Insurance companies will pay to know who eats fast food four times a week. Real estate developers will pay to know which blocks are foot-traffic gold. The number gets large. The answer is no.",
      { h2: "We will never run ads" },
      "An ad-supported model means we work for whoever pays us. We'd rather work for you, charge a few dollars eventually, and have one customer instead of two with conflicting interests.",
      { h2: "We will never gamify eating" },
      "No streaks designed to make you eat out more. No achievements for trying ten new restaurants. Palate is a mirror, not a coach. The day we start nudging your behavior — even gently — we've crossed a line.",
      { h2: "We will never auto-share" },
      "Your weekly Wrapped is for you. If you want to share, the app gives you a beautiful card and a button. If you don't, nothing leaves your phone. There is no 'connect to friends' switch we can flip later.",
      { h2: "We will never compare you negatively" },
      "When the social comparison feature ships, it'll be neutral pattern overlap — 'you and 12% of NYC are also Café Dwellers.' Never 'your friend ate at three more restaurants than you this week.' The vibe should be recognition, not competition.",
      { h2: "What this leaves us with" },
      "A small, calm app that does one thing: tells you who you are, the way you eat. We won't grow as fast as the apps that say yes to everything above. We're betting that's a feature, not a bug.",
    ],
  },
  {
    slug: "nine-ways-to-eat",
    title: "There are nine ways to eat. Which one are you?",
    dek: "Every Palate user lands on one of nine identities. Here's all of them — and why we picked these specifically.",
    publishedAt: "2026-04-30",
    author: "Kenton McNeal",
    readingMinutes: 5,
    body: [
      "When we started Palate, we had three personas. By the time we got to 9, we knew we'd done it right — because almost everyone we tested it on said \"oh, I'm definitely a [X],\" and they were correct, and they were a little exposed.",
      "Here's the full taxonomy. Notice that some of these look similar from the outside but are *behaviorally different*. That's the whole point.",
      { h2: "1. The Convenience Loyalist" },
      "You eat at the same 2-3 places on rotation. McDonald's, Starbucks, Subway. Not because you love them, but because choosing is exhausting and your time is worth more than the marginal upgrade. Speed and familiarity, no thinking required.",
      { h2: "2. The Flavor Loyalist" },
      "You also repeat — but for completely different reasons. You went to Burger King three times this week not because it was on the way, but because you specifically wanted that flame-grilled flavor. You're a regular at Popeyes because it scratches a specific itch nothing else does.",
      "On paper you and the Convenience Loyalist look identical (high repeat rate, fast food). In behavior you're opposite — you're craving, they're avoiding decisions.",
      { h2: "3. The Premium Comfort Loyalist" },
      "You'll pay 2x for the same good thing. You go to Sweetgreen, Cava, Shake Shack on rotation — not the cheapest, not the fanciest, but the ones you've already filtered the noise on. Loyal to a feeling, not a price tag.",
      { h2: "4. The Practical Variety Seeker" },
      "Healthy on Tuesday, indulgent on Friday, somewhere new on Sunday. You're not loyal but you're not random — you're picking different modes for different reasons. People ask 'what kind of food do you like?' and the answer is genuinely 'depends.'",
      { h2: "5. The Explorer" },
      "You barely repeat. 11 visits, 10 different places. Your camera roll is half restaurant signs. You'd rather try and miss than repeat and feel safe. Some of your best meals are places friends dragged you to.",
      { h2: "6. The Café Dweller" },
      "Five out of seven mornings start the same way. You pick places that feel like extensions of your living room. The barista knows your order. You'd take a long brunch with great coffee over a fancy dinner most days.",
      { h2: "7. The Healthy Optimizer" },
      "Bowls and counter service. Sweetgreen over cooking even when you have time. You optimize for speed without giving up the plot — a bowl is the ideal compromise between 'fast' and 'I'm being good.'",
      { h2: "8. The Comfort Food Connoisseur" },
      "You eat what you actually want, not what looks good on Instagram. Pizza is a personality trait. The fancy place can wait — tonight is the slice, the burger, the bowl that just hits.",
      { h2: "9. The Social Diner" },
      "Food is the excuse, the table is the point. You'd take a mediocre meal with great people over a great meal alone every time. Your most memorable meals are about the company, not the cuisine.",
      { h2: "Why these nine" },
      "Three principles guided the cuts. (1) Each persona must be *behaviorally* distinct, not just stylistically. (2) Each must feel slightly exposing — not insulting, but recognizable. (3) The set must cover ~95% of how Americans actually eat in cities, leaving room for refinement later.",
      "Take the quiz to find your starter. The real one — built from where you actually go — comes after a week of visits.",
    ],
  },
  {
    slug: "your-taste-isnt-your-opinion",
    title: "Your taste isn't your opinion.",
    dek: "Why behavioral data is more honest than rating data — and why most food apps are measuring the wrong thing.",
    publishedAt: "2026-04-30",
    author: "Kenton McNeal",
    readingMinutes: 4,
    body: [
      "Ask 100 people what kind of food they like, and you'll get 100 wrong answers.",
      "Not lies — wrong answers. People genuinely believe what they say. They'll tell you they prefer healthy food, that they don't really like fast food, that they only go out a couple times a week. Then you look at their bank statements and find out they spent $2,800 at Sweetgreen and Chipotle last year.",
      "There's a name for this gap in psychology: the *say-do gap*. The distance between what people report about themselves and what they actually do. It's huge for food, exercise, screen time, basically anything we have feelings about.",
      { h2: "Why ratings are unreliable" },
      "When you rate something, you're performing. Sometimes for an audience, sometimes just for yourself. You give the upscale restaurant five stars because you went there for an anniversary and it would feel ungenerous to grade it harshly. You give the chain four stars because you don't want to feel basic.",
      "The rating reflects the version of yourself you'd like to be — not the version that makes the actual decisions about where to go.",
      { h2: "Why visits are reliable" },
      "When you walk into a restaurant, you've made a decision against every other available option in that moment. You weighed convenience, money, mood, time, distance, and what you were craving. Then you voted with your feet.",
      "Repeat that 5.9 times a week — the BLS average for Americans — and after a year you have ~300 honest data points about what you actually want, vs whatever you'd say in a survey.",
      { h2: "What Palate does with the data" },
      "We don't add a rating layer. Adding ratings would re-introduce the say-do gap inside our own product.",
      "Instead we just count. How often do you go where? At what time? In what kind of format (quick service vs sit-down vs café)? With what flavor profile? Then we map the patterns to one of nine identities. The data is honest because the act of generating it is honest — you tapped Yes after walking into a place.",
      { h2: "The implication" },
      "If you take Palate seriously for a few weeks, you'll learn things about yourself that you'd have sworn weren't true. People discover they're café dwellers when they thought they were varied. They discover they're loyalists when they thought they were exploratory. They discover they spend 3x what they thought on takeout.",
      "Some of those discoveries lead to changing behavior. Most don't. The point isn't to optimize — it's to *know*. That's the part most apps skip, and that's the part we built Palate to handle.",
    ],
  },
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

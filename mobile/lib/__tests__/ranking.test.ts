import {
  DEFAULT_RATING,
  expectedScore,
  kFactor,
  applyComparison,
  pickOpponent,
  rankedOrder,
  rankingConfidence,
  type Rated,
} from "../ranking";

const r = (id: string, rating = DEFAULT_RATING, comparisons = 0): Rated => ({
  restaurantId: id,
  rating,
  comparisons,
});

// Ranking math fails silently: a wrong K-factor or a sign error produces a list
// that looks plausible and is meaningless. Nobody reports it, they just stop
// trusting the feature. Hence the tests are the specification.

describe("expectedScore", () => {
  it("is a coin flip between equals", () => {
    expect(expectedScore(1500, 1500)).toBeCloseTo(0.5, 6);
  });

  it("favours the higher-rated place, symmetrically", () => {
    const a = expectedScore(1700, 1500);
    const b = expectedScore(1500, 1700);
    expect(a).toBeGreaterThan(0.5);
    expect(a + b).toBeCloseTo(1, 6);
  });

  it("puts a 400-point gap at the standard ~10:1", () => {
    expect(expectedScore(1900, 1500)).toBeCloseTo(10 / 11, 3);
  });
});

describe("kFactor", () => {
  it("moves a new place fast and an established one slowly", () => {
    expect(kFactor(0)).toBeGreaterThan(kFactor(5));
    expect(kFactor(5)).toBeGreaterThan(kFactor(50));
  });
});

describe("applyComparison", () => {
  it("raises the winner and lowers the loser", () => {
    const { winner, loser } = applyComparison(r("a"), r("b"));
    expect(winner.rating).toBeGreaterThan(DEFAULT_RATING);
    expect(loser.rating).toBeLessThan(DEFAULT_RATING);
  });

  it("counts the comparison for both — an upset must cost the loser too", () => {
    const { winner, loser } = applyComparison(r("a"), r("b"));
    expect(winner.comparisons).toBe(1);
    expect(loser.comparisons).toBe(1);
  });

  it("conserves rating between two equally-established places", () => {
    // Otherwise the pool inflates or deflates over time and the numbers drift
    // away from any fixed meaning.
    const before = DEFAULT_RATING * 2;
    const { winner, loser } = applyComparison(r("a"), r("b"));
    expect(winner.rating + loser.rating).toBeCloseTo(before, 6);
  });

  it("barely moves a favourite that beats a nobody", () => {
    const { winner } = applyComparison(r("fav", 1900, 20), r("weak", 1200, 20));
    expect(winner.rating - 1900).toBeLessThan(2);
  });

  it("moves a lot on a genuine upset", () => {
    const { winner } = applyComparison(r("weak", 1200, 20), r("fav", 1900, 20));
    expect(winner.rating - 1200).toBeGreaterThan(10);
  });

  it("does not mutate its inputs", () => {
    const a = r("a");
    const b = r("b");
    applyComparison(a, b);
    expect(a.rating).toBe(DEFAULT_RATING);
    expect(b.comparisons).toBe(0);
  });
});

describe("pickOpponent", () => {
  it("returns null when there is nobody to compare against", () => {
    expect(pickOpponent(r("a"), [r("a")])).toBeNull();
    expect(pickOpponent(r("a"), [])).toBeNull();
  });

  it("picks the closest rating — the least predictable question", () => {
    const subject = r("s", 1500);
    const pool = [r("far", 1900), r("near", 1520), r("mid", 1650)];
    expect(pickOpponent(subject, pool)?.restaurantId).toBe("near");
  });

  it("breaks a tie toward the place we know least about", () => {
    const subject = r("s", 1500);
    const pool = [r("known", 1520, 12), r("new", 1520, 0)];
    expect(pickOpponent(subject, pool)?.restaurantId).toBe("new");
  });

  it("never offers the subject against itself", () => {
    const subject = r("s", 1500, 3);
    expect(pickOpponent(subject, [subject])?.restaurantId).toBeUndefined();
  });
});

describe("rankedOrder", () => {
  it("sorts best first", () => {
    const out = rankedOrder([r("c", 1400), r("a", 1800), r("b", 1600)]);
    expect(out.map((x) => x.restaurantId)).toEqual(["a", "b", "c"]);
  });

  it("puts the better-established place above a newcomer on a tie", () => {
    const out = rankedOrder([r("new", 1500, 0), r("proven", 1500, 9)]);
    expect(out[0].restaurantId).toBe("proven");
  });
});

describe("rankingConfidence", () => {
  it("says nothing with fewer than two places", () => {
    expect(rankingConfidence([])).toBe("none");
    expect(rankingConfidence([r("a")])).toBe("none");
  });

  it("rises as places get compared", () => {
    expect(rankingConfidence([r("a"), r("b")])).toBe("low");
    expect(rankingConfidence([r("a", 1500, 2), r("b", 1500, 2)])).toBe("medium");
    expect(rankingConfidence([r("a", 1500, 8), r("b", 1500, 8)])).toBe("high");
  });
});

describe("convergence — the property that actually matters", () => {
  it("recovers a known true order from noisy pairwise answers", () => {
    // Five places with a real quality order. Simulate an honest user who
    // answers correctly 85% of the time, and check the list comes out right.
    const truth = ["best", "second", "third", "fourth", "worst"];
    const quality = new Map(truth.map((id, i) => [id, truth.length - i]));
    let pool: Rated[] = truth.map((id) => r(id));

    // Deterministic pseudo-random so the test cannot flake.
    let seed = 42;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    for (let i = 0; i < 400; i++) {
      const subject = pool[Math.floor(rand() * pool.length)];
      const opponent = pickOpponent(subject, pool);
      if (!opponent) continue;

      const subjectIsBetter =
        (quality.get(subject.restaurantId) ?? 0) > (quality.get(opponent.restaurantId) ?? 0);
      // 15% of answers are wrong, as real preferences are.
      const answersHonestly = rand() > 0.15;
      const subjectWins = answersHonestly ? subjectIsBetter : !subjectIsBetter;

      const { winner, loser } = subjectWins
        ? applyComparison(subject, opponent)
        : applyComparison(opponent, subject);

      pool = pool.map((p) =>
        p.restaurantId === winner.restaurantId ? winner
        : p.restaurantId === loser.restaurantId ? loser
        : p,
      );
    }

    const finalOrder = rankedOrder(pool).map((p) => p.restaurantId);
    expect(finalOrder[0]).toBe("best");
    expect(finalOrder[finalOrder.length - 1]).toBe("worst");
    expect(rankingConfidence(pool)).toBe("high");
  });
});

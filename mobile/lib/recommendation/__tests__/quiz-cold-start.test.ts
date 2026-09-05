import { assembleGraph, emptyVector } from "../taste-graph";
import { computeCompatibility } from "../compatibility";
import { applyPersonaPrior } from "../../persona-prior";

// The onboarding quiz seeded flavor/format/price keys into an otherwise empty
// vector. Taste then had "entries", skipped its neutral branch, and every
// restaurant scored 0 on taste — a person who took the quiz saw WORSE scores
// than one who skipped it, on every place. Found by the code review.
//
// The quiz should shape scores where it has an opinion (format, price) and
// stay neutral where it has none (cuisine). Two places, one persona.
describe("quiz cold start", () => {
  const seeded = emptyVector();
  applyPersonaPrior(seeded, "cafe_dweller" as never);
  const quizGraph = assembleGraph(seeded, null);
  const blankGraph = assembleGraph(emptyVector(), null);

  const trattoria = {
    google_place_id: "p1", name: "Trattoria",
    cuisine_type: "italian", cuisine_region: "italian", cuisine_subregion: "italian_trattoria",
    format_class: "casual_dining", price_level: 3, rating: 4.5, user_rating_count: 300,
  };
  const cafe = {
    google_place_id: "p2", name: "Corner Café",
    cuisine_type: null, cuisine_region: null, cuisine_subregion: null,
    format_class: "café", price_level: 1, rating: 4.5, user_rating_count: 300,
  };

  it("does not sink a mismatching place to the floor", () => {
    const quiz = computeCompatibility(quizGraph, trattoria).score;
    expect(quiz).toBeGreaterThanOrEqual(40);
  });

  it("lifts a place that matches what the quiz said", () => {
    const blank = computeCompatibility(blankGraph, cafe).score;
    const quiz = computeCompatibility(quizGraph, cafe).score;
    expect(quiz).toBeGreaterThanOrEqual(blank);
  });
});

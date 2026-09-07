import { addUsage, costUsd, project, ZERO_USAGE, HAIKU_RATES, formatUsd } from "../../../evals/classifier/cost";

// The arithmetic that decides whether a backfill is a rounding error or a bill.
// Worth its own test because it is the number a spending decision rests on.
describe("eval cost arithmetic", () => {
  it("prices each token class at its own rate", () => {
    const u = addUsage(ZERO_USAGE, {
      input_tokens: 1_000_000, output_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000, cache_creation_input_tokens: 1_000_000,
    });
    expect(costUsd(u)).toBeCloseTo(
      HAIKU_RATES.input + HAIKU_RATES.output + HAIKU_RATES.cacheRead + HAIKU_RATES.cacheWrite, 6);
  });

  it("charges a cached read at a fraction of a fresh one", () => {
    const fresh = costUsd(addUsage(ZERO_USAGE, { input_tokens: 1_000_000 }));
    const cached = costUsd(addUsage(ZERO_USAGE, { cache_read_input_tokens: 1_000_000 }));
    expect(cached).toBeLessThan(fresh / 5);
  });

  it("projects a full run from a measured sample", () => {
    const u = addUsage(ZERO_USAGE, { input_tokens: 20_000, output_tokens: 4_000 });
    // 20 places measured, 1342 to do.
    expect(project(u, 20, 1342)).toBeCloseTo((costUsd(u) / 20) * 1342, 8);
  });

  it("returns zero rather than dividing by an empty sample", () => {
    expect(project(ZERO_USAGE, 0, 1342)).toBe(0);
  });

  it("shows small amounts at a precision that does not round them to nothing", () => {
    expect(formatUsd(0.0032)).toBe("$0.0032");
    expect(formatUsd(4.2)).toBe("$4.20");
  });
});

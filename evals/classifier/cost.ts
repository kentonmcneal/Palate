// ============================================================================
// Turning token counts into dollars, out loud.
// ----------------------------------------------------------------------------
// These rates are written down rather than folded into a single number so the
// arithmetic is auditable and so a stale price is obvious rather than silently
// wrong. VERIFY THEM against current pricing before quoting a figure to
// anybody; they are the one thing in this repo that changes without a commit.
//
// Cache reads matter more than they look. classifyWithLLM marks the system
// prompt cache_control: ephemeral, and that prompt is the bulk of the input on
// every call. Across a backfill, almost every place after the first reads the
// prompt from cache instead of paying for it — which is why a per-place
// estimate made by multiplying the full prompt by the row count overstates the
// bill, and why this reports measured usage instead of estimating at all.
// ============================================================================

/** claude-haiku-4-5, US dollars per million tokens. Verify before quoting. */
export const HAIKU_RATES = {
  input: 1.00,
  output: 5.00,
  cacheWrite: 1.25,
  cacheRead: 0.10,
} as const;

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
};

export const ZERO_USAGE: Usage = {
  input_tokens: 0, output_tokens: 0,
  cache_read_input_tokens: 0, cache_creation_input_tokens: 0,
};

export function addUsage(a: Usage, b: Partial<Usage>): Usage {
  return {
    input_tokens: a.input_tokens + (b.input_tokens ?? 0),
    output_tokens: a.output_tokens + (b.output_tokens ?? 0),
    cache_read_input_tokens: a.cache_read_input_tokens + (b.cache_read_input_tokens ?? 0),
    cache_creation_input_tokens: a.cache_creation_input_tokens + (b.cache_creation_input_tokens ?? 0),
  };
}

export function costUsd(u: Usage): number {
  const m = 1_000_000;
  return (
    (u.input_tokens / m) * HAIKU_RATES.input +
    (u.output_tokens / m) * HAIKU_RATES.output +
    (u.cache_creation_input_tokens / m) * HAIKU_RATES.cacheWrite +
    (u.cache_read_input_tokens / m) * HAIKU_RATES.cacheRead
  );
}

/** What a run of `n` places would cost, from a measured sample of `sampled`. */
export function project(u: Usage, sampled: number, n: number): number {
  if (sampled <= 0) return 0;
  return (costUsd(u) / sampled) * n;
}

export function formatUsd(v: number): string {
  return v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}

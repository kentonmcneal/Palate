// A static SVG-styled mock of the weekly Wrapped card.
// Lives on the landing page to communicate "this is what you'd get."

export function WrappedPreview() {
  return (
    <div className="relative rounded-3xl bg-palate-ink text-white p-8 sm:p-10 shadow-2xl overflow-hidden">
      <div className="absolute -top-16 -right-16 w-56 h-56 rounded-full bg-palate-red/40 blur-3xl" />
      <div className="absolute -bottom-20 -left-12 w-48 h-48 rounded-full bg-palate-red/30 blur-3xl" />

      <div className="relative">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-palate-red flex items-center justify-center">
              <span className="text-white font-bold leading-none text-sm">p</span>
            </div>
            <span className="text-sm font-medium opacity-80">your week</span>
          </div>
          <span className="text-xs opacity-70">Apr 22 — Apr 28</span>
        </div>

        <div className="mt-8">
          <div className="text-xs uppercase tracking-widest opacity-70">You are</div>
          <div className="text-3xl sm:text-4xl font-bold mt-1 text-palate-red">The Fast Casual Regular</div>
        </div>

        <div className="mt-8 grid grid-cols-3 gap-4">
          <Stat label="visits" value="12" />
          <Stat label="places" value="7" />
          <Stat label="repeat" value="42%" />
        </div>

        <div className="mt-8">
          <div className="text-xs uppercase tracking-widest opacity-70 mb-2">Top spots</div>
          <ol className="space-y-2 text-sm">
            <Row n={1} name="Sweetgreen" count={4} />
            <Row n={2} name="Joe & The Juice" count={2} />
            <Row n={3} name="Joe's Pizza" count={2} />
          </ol>
        </div>

        <div className="mt-8 text-xs opacity-70">palate.app</div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
      <div className="text-2xl sm:text-3xl font-bold">{value}</div>
      <div className="text-[11px] uppercase tracking-widest opacity-70 mt-1">{label}</div>
    </div>
  );
}

function Row({ n, name, count }: { n: number; name: string; count: number }) {
  return (
    <li className="flex items-center justify-between border-b border-white/10 pb-2">
      <span>
        <span className="opacity-50 mr-3">{n}</span>
        {name}
      </span>
      <span className="opacity-70">×{count}</span>
    </li>
  );
}

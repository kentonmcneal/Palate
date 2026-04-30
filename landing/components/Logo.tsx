// Palate logo — a lowercase rounded "p" in brand red.
// Matches preview.html's exact SVG markup.

export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-label="Palate"
      role="img"
    >
      <rect width="64" height="64" rx="16" fill="#FF3008" />
      <rect x="19" y="14" width="7" height="38" rx="3.5" fill="#fff" />
      <path d="M 26 16 H 36 a 12 12 0 0 1 0 24 H 26 Z" fill="#fff" />
      <circle cx="34" cy="28" r="4" fill="#FF3008" />
    </svg>
  );
}

export function Wordmark({
  size = 32,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <Logo size={size} />
      <span className="text-xl font-semibold tracking-tightish">palate</span>
    </div>
  );
}

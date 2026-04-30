// ============================================================================
// /api/palate-card/[persona] — dynamic 1080x1080 PNG of a Starter Palate result.
// ----------------------------------------------------------------------------
// Visit /api/palate-card/explorer (or any starter-persona key) to get a
// share-ready image. Used by the quiz's "Share my Palate" button and as
// the og:image for /share/[persona] in the future.
// ============================================================================

import { ImageResponse } from "next/og";
import { STARTER_PERSONAS, type StarterPersonaKey } from "@/config/starter-personas";

export const runtime = "edge";

const SIZE = 1080;

export async function GET(
  _req: Request,
  { params }: { params: { persona: string } },
) {
  const key = params.persona as StarterPersonaKey;
  const persona = STARTER_PERSONAS[key];
  if (!persona) {
    return new Response("Not found", { status: 404 });
  }

  // Pull up to 3 chips from the persona's coreSignals — we don't have the
  // user's actual quiz answers in this stateless route, so we use the
  // persona's canonical signals as the next-best descriptor.
  const chips = persona.coreSignals.slice(0, 3).map((s) => signalChipLabel(s));

  return new ImageResponse(
    (
      <div
        style={{
          width: SIZE,
          height: SIZE,
          display: "flex",
          flexDirection: "column",
          padding: 80,
          color: "#fff",
          background: "linear-gradient(135deg,#1A1A1A 0%,#0E0E0E 100%)",
          position: "relative",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        {/* Brand wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: "#FF3008",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 36,
              fontWeight: 800,
            }}
          >
            p
          </div>
          <span style={{ fontSize: 32, fontWeight: 600, letterSpacing: -1 }}>palate</span>
        </div>

        {/* Eyebrow + persona reveal */}
        <div style={{ marginTop: 120, display: "flex", flexDirection: "column" }}>
          <span
            style={{
              fontSize: 22,
              letterSpacing: 4,
              textTransform: "uppercase",
              opacity: 0.6,
            }}
          >
            Your starter Palate
          </span>
          <span
            style={{
              marginTop: 24,
              fontSize: 96,
              fontWeight: 800,
              letterSpacing: -3,
              color: "#FF3008",
              lineHeight: 1.02,
            }}
          >
            {persona.label}
          </span>
          <span
            style={{
              marginTop: 28,
              fontSize: 38,
              fontWeight: 500,
              opacity: 0.92,
              fontStyle: "italic",
              maxWidth: 880,
            }}
          >
            "{persona.tagline}"
          </span>
        </div>

        {/* Chips */}
        <div
          style={{
            marginTop: 64,
            display: "flex",
            gap: 14,
            flexWrap: "wrap",
          }}
        >
          {chips.map((c) => (
            <span
              key={c}
              style={{
                background: "rgba(255,255,255,0.08)",
                border: "1.5px solid rgba(255,255,255,0.18)",
                color: "#fff",
                fontSize: 24,
                fontWeight: 600,
                padding: "12px 22px",
                borderRadius: 999,
              }}
            >
              {c}
            </span>
          ))}
        </div>

        {/* Footer CTA */}
        <div
          style={{
            position: "absolute",
            left: 80,
            bottom: 80,
            right: 80,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontSize: 30, fontWeight: 700, color: "#FF3008" }}>
            Find your Palate →
          </span>
          <span style={{ fontSize: 22, opacity: 0.55 }}>palate.app</span>
        </div>
      </div>
    ),
    {
      width: SIZE,
      height: SIZE,
    },
  );
}

// Light-touch label map so we don't have to import signals.ts in the edge
// runtime. Keep in sync with config/signals.ts labels.
function signalChipLabel(key: string): string {
  const map: Record<string, string> = {
    routine: "Routine eater",
    novelty: "Novelty seeker",
    convenience: "Convenience matters",
    indulgence: "Indulgent",
    healthy_ish: "Healthy-ish",
    premium: "Premium-leaning",
    value: "Value-driven",
    social: "Social",
    late_night: "Late-night",
    flavor_driven: "Flavor-driven",
    no_friction: "Low decision effort",
    intentional: "Intentional",
  };
  return map[key] ?? key;
}

// ============================================================================
// /admin — server-rendered waitlist viewer for the founder.
// ----------------------------------------------------------------------------
// Gated behind ?key=<ADMIN_PASSWORD>. Not robust auth, but enough for a
// pre-launch internal page. Uses the service role key on the server only.
// Set ADMIN_PASSWORD and SUPABASE_SERVICE_ROLE_KEY in Vercel env vars.
// ============================================================================

import { Logo } from "@/components/Logo";
import { isAdminKeyValid, getWaitlistStats } from "@/lib/admin";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Admin — Palate",
  robots: "noindex, nofollow",
};

export default async function AdminPage({
  searchParams,
}: {
  searchParams: { key?: string };
}) {
  if (!isAdminKeyValid(searchParams.key)) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
        <Logo size={40} />
        <h1 className="mt-6 text-2xl font-semibold tracking-tightish">Admin</h1>
        <p className="mt-3 text-palate-mute text-sm max-w-sm">
          Append <code>?key=YOUR_ADMIN_PASSWORD</code> to the URL.
        </p>
      </main>
    );
  }

  const stats = await getWaitlistStats();
  if (!stats) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold">Service role key not set</h1>
          <p className="mt-2 text-palate-mute text-sm">
            Add <code>SUPABASE_SERVICE_ROLE_KEY</code> to Vercel env vars to enable this page.
          </p>
        </div>
      </main>
    );
  }

  const sources = Object.entries(stats.bySource).sort((a, b) => b[1] - a[1]);

  return (
    <main id="main" className="max-w-5xl mx-auto px-6 py-12">
      <div className="flex items-center gap-3">
        <Logo size={32} />
        <span className="text-xl font-semibold tracking-tightish">palate · admin</span>
      </div>

      <div className="mt-10 grid sm:grid-cols-3 gap-4">
        <Stat label="Total signups" value={stats.total.toLocaleString()} />
        <Stat label="Last 7 days" value={`+${stats.last7Days}`} accent />
        <Stat label="Sources" value={String(sources.length)} />
      </div>

      <section className="mt-12">
        <h2 className="text-xs font-semibold text-palate-mute tracking-widest uppercase mb-4">
          By source
        </h2>
        <div className="rounded-2xl border border-palate-line bg-white overflow-hidden">
          {sources.map(([src, count], i) => (
            <div
              key={src}
              className={`flex justify-between px-5 py-3 ${i > 0 ? "border-t border-palate-line" : ""}`}
            >
              <span className="text-sm font-medium">{src}</span>
              <span className="text-sm text-palate-mute">{count.toLocaleString()}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-xs font-semibold text-palate-mute tracking-widest uppercase mb-4">
          Top referrers (last 100 signups)
        </h2>
        {stats.topReferrers.length === 0 ? (
          <p className="text-sm text-palate-mute">No referrals yet.</p>
        ) : (
          <div className="rounded-2xl border border-palate-line bg-white overflow-hidden">
            {stats.topReferrers.map((r, i) => (
              <div
                key={r.code}
                className={`flex justify-between px-5 py-3 ${i > 0 ? "border-t border-palate-line" : ""}`}
              >
                <div>
                  <div className="font-medium text-sm">{r.email ?? "(unknown)"}</div>
                  <div className="text-xs text-palate-mute font-mono">{r.code}</div>
                </div>
                <span className="text-sm font-semibold text-palate-red">
                  {r.count} {r.count === 1 ? "referral" : "referrals"}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-12">
        <h2 className="text-xs font-semibold text-palate-mute tracking-widest uppercase mb-4">
          Recent signups (latest 100)
        </h2>
        <div className="rounded-2xl border border-palate-line bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-palate-soft text-xs uppercase tracking-wider text-palate-mute">
              <tr>
                <th className="text-left px-5 py-2.5 font-semibold">When</th>
                <th className="text-left px-5 py-2.5 font-semibold">Email</th>
                <th className="text-left px-5 py-2.5 font-semibold">Source</th>
                <th className="text-left px-5 py-2.5 font-semibold">Referred by</th>
              </tr>
            </thead>
            <tbody>
              {stats.recent.map((r) => (
                <tr key={r.id} className="border-t border-palate-line">
                  <td className="px-5 py-2.5 text-palate-mute whitespace-nowrap">
                    {new Date(r.created_at).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-5 py-2.5">{r.email}</td>
                  <td className="px-5 py-2.5 text-palate-mute">{r.source ?? "—"}</td>
                  <td className="px-5 py-2.5 text-palate-mute font-mono text-xs">{r.referred_by ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-12 text-xs text-palate-mute">
        Showing the most recent 100 signups. Total above counts all rows.
      </div>
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-palate-line bg-white p-6">
      <div className="text-xs uppercase tracking-widest text-palate-mute font-semibold">
        {label}
      </div>
      <div className={`mt-2 text-4xl font-bold ${accent ? "text-palate-red" : "text-palate-ink"}`}>
        {value}
      </div>
    </div>
  );
}
